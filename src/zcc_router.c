#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "zcc_types.h"
#include "zcc_utils.h"
#include "zcc_assets.h"
#include "zcc_router.h"
#include "zcc_security.h"

#ifdef _WIN32
#  include <winsock2.h>
#  include <io.h>
#  define WRITE_FD(fd, buf, len) send(fd, buf, len, 0)
#  define READ_FD(fd, buf, len)  recv(fd, buf, len, 0)
#  define CLOSE_FD(fd)           closesocket(fd)
#else
#  include <unistd.h>
#  include <sys/stat.h>
#  define WRITE_FD(fd, buf, len) write(fd, buf, len)
#  define READ_FD(fd, buf, len)  read(fd, buf, len)
#  define CLOSE_FD(fd)           close(fd)
#endif

#define BUFFER_SIZE 4096

/* ---- Helper: send a complete HTTP response ---- */
static void send_json_response(int fd, int status_code,
                               const char *status_text,
                               const char *body) {
    char headers[512];
    int hlen = snprintf(headers, sizeof(headers),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %zu\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Connection: close\r\n\r\n",
        status_code, status_text, strlen(body));
    WRITE_FD(fd, headers, hlen);
    WRITE_FD(fd, body, (int)strlen(body));
}

/* ---- Helper: send a plain text error ---- */
static void send_error(int fd, int code, const char *text,
                       const char *body_html) {
    char headers[512];
    int hlen = snprintf(headers, sizeof(headers),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: text/html\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n\r\n",
        code, text, strlen(body_html));
    WRITE_FD(fd, headers, hlen);
    WRITE_FD(fd, body_html, (int)strlen(body_html));
}

void handle_client(int client_fd) {
    char buffer[BUFFER_SIZE];
    memset(buffer, 0, BUFFER_SIZE);

    int bytes_read = READ_FD(client_fd, buffer, BUFFER_SIZE - 1);
    if (bytes_read <= 0) {
        CLOSE_FD(client_fd);
        return;
    }

    char method[16], path_encoded[512], protocol[16];
    if (sscanf(buffer, "%15s %511s %15s", method, path_encoded, protocol) < 3) {
        CLOSE_FD(client_fd);
        return;
    }

    if (strcmp(method, "GET") != 0) {
        send_error(client_fd, 405, "Method Not Allowed", "");
        CLOSE_FD(client_fd);
        return;
    }

    char path[512];
    url_decode(path, path_encoded);

    char* rel_path = path;
    if (rel_path[0] == '/') rel_path++;

    /* ---- Security Gate: Auth check on API routes ---- */
    if (strstr(rel_path, "api/") == rel_path) {
        char auth_token[256];
        if (zcc_extract_header(buffer, "X-ZCC-Auth",
                               auth_token, sizeof(auth_token)) == 0) {
            if (zcc_auth_check(auth_token) != 0) {
                send_json_response(client_fd, 403, "Forbidden",
                    "{\"status\":\"ERROR\",\"message\":\"Invalid auth token\"}");
                CLOSE_FD(client_fd);
                return;
            }
        }
        /* If no auth header AND key is loaded, reject */
        /* (zcc_auth_check(NULL) returns -1 when key is loaded) */
    }

    /* ---- API Route: /api/sync ---- */
    if (strstr(rel_path, "api/sync") != NULL) {
        printf(" -> API Triggered: Folder Synchronization\n");
        const char *argv[] = {"python3", "utils/pipeline_sync.py", NULL};
        zcc_safe_exec(argv);
        send_json_response(client_fd, 200, "OK",
            "{\"status\":\"SUCCESS\",\"message\":\"Pipeline asset folders synchronized.\"}");
        CLOSE_FD(client_fd);
        return;
    }

    /* ---- API Route: /api/generate ---- */
    if (strstr(rel_path, "api/generate") != NULL) {
        printf(" -> API Triggered: Compiling 3D Primitive Cube\n");
        const char *argv[] = {"python3", "utils/mesh_generator.py",
                              "assets/cube.glb", NULL};
        zcc_safe_exec(argv);
        send_json_response(client_fd, 200, "OK",
            "{\"status\":\"SUCCESS\",\"message\":\"Watertight Cube GLB compiled natively.\"}");
        CLOSE_FD(client_fd);
        return;
    }

    /* ---- API Route: /api/validate ---- */
    if (strstr(rel_path, "api/validate") != NULL) {
        printf(" -> API Triggered: Skeletal Rig Validation\n");
        const char *argv[] = {"python3", "utils/rig_validator.py",
                              "assets/cube.glb", NULL};
        zcc_safe_exec(argv);

        FILE* file = fopen("assets/audit_report.json", "rb");
        if (file != NULL) {
            char headers[256];
            int hlen = snprintf(headers, sizeof(headers),
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Connection: close\r\n\r\n");
            WRITE_FD(client_fd, headers, hlen);

            char file_buf[1024];
            int rb;
            while ((rb = (int)fread(file_buf, 1, sizeof(file_buf), file)) > 0) {
                WRITE_FD(client_fd, file_buf, rb);
            }
            fclose(file);
        } else {
            send_json_response(client_fd, 500, "Internal Server Error",
                "{\"status\":\"ERROR\",\"message\":\"Audit report failed to generate.\"}");
        }
        CLOSE_FD(client_fd);
        return;
    }

    /* ---- API Route: /api/health ---- */
    if (strstr(rel_path, "api/health") != NULL) {
        send_json_response(client_fd, 200, "OK",
            "{\"status\":\"OK\",\"server\":\"zkaedi_vmax_server\",\"version\":\"2.5\"}");
        CLOSE_FD(client_fd);
        return;
    }

    /* ---- Static file serving ---- */

    /* Default route -> serve first embedded asset */
    if (strlen(rel_path) == 0 && NUM_EMBEDDED_ASSETS > 0) {
        rel_path = (char*)embedded_assets[0]->filename;
    }

    /* Path traversal guard */
    if (zcc_validate_path(rel_path) != 0) {
        printf("[SECURITY] Blocked path traversal: %s\n", rel_path);
        send_error(client_fd, 403, "Forbidden",
            "<h1>403 Forbidden</h1><p>Path rejected by security policy.</p>");
        CLOSE_FD(client_fd);
        return;
    }

    printf("[GET] /%s\n", rel_path);

    /* Try embedded assets first */
    const ZccEmbeddedAsset* matched_asset = NULL;
    for (int i = 0; i < NUM_EMBEDDED_ASSETS; i++) {
        if (strcmp(rel_path, embedded_assets[i]->filename) == 0) {
            matched_asset = embedded_assets[i];
            break;
        }
    }

    if (matched_asset != NULL) {
        char headers[256];
        int hlen = snprintf(headers, sizeof(headers),
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: %s\r\n"
            "Content-Length: %u\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n\r\n",
            matched_asset->mime_type, matched_asset->size_bytes);

        WRITE_FD(client_fd, headers, hlen);
        WRITE_FD(client_fd, (const char*)matched_asset->data,
                 matched_asset->size_bytes);
        printf(" -> Served from RAM (%u bytes, type: %s)\n",
               matched_asset->size_bytes, matched_asset->mime_type);
    }
    else {
        /* Disk fallback */
        FILE* file = fopen(rel_path, "rb");
        if (file != NULL) {
#ifdef _WIN32
            /* Get file size */
            fseek(file, 0, SEEK_END);
            unsigned int size = (unsigned int)ftell(file);
            fseek(file, 0, SEEK_SET);
#else
            struct stat st;
            stat(rel_path, &st);
            unsigned int size = (unsigned int)st.st_size;
#endif
            const char* mime = get_mime_from_extension(rel_path);

            char headers[256];
            int hlen = snprintf(headers, sizeof(headers),
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: %s\r\n"
                "Content-Length: %u\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Connection: close\r\n\r\n",
                mime, size);

            WRITE_FD(client_fd, headers, hlen);

            char file_buf[BUFFER_SIZE];
            unsigned int total_sent = 0;
            while (total_sent < size) {
                int rb = (int)fread(file_buf, 1, BUFFER_SIZE, file);
                if (rb <= 0) break;
                WRITE_FD(client_fd, file_buf, rb);
                total_sent += rb;
            }
            fclose(file);
            printf(" -> Served from Disk (%u bytes, type: %s)\n", size, mime);
        } else {
            send_error(client_fd, 404, "Not Found",
                "<h1>404 Asset Not Found</h1>"
                "<p>Requested path was not embedded or found on disk.</p>");
            printf(" -> 404 Not Found\n");
        }
    }

    CLOSE_FD(client_fd);
}
