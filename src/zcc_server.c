#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "zcc_types.h"
#include "zcc_utils.h"
#include "zcc_network.h"
#include "zcc_router.h"
#include "zcc_assets.h"
#include "zcc_security.h"

#ifdef _WIN32
#  include <winsock2.h>
#  include <windows.h>
#  define CLOSE_FD(fd) closesocket(fd)
   /* Win32 threading via CreateThread */
#else
#  include <unistd.h>
#  include <pthread.h>
#  define CLOSE_FD(fd) close(fd)
#endif

#define PORT 8080

#ifdef _WIN32

static DWORD WINAPI client_thread_worker(LPVOID arg) {
    int client_fd = *((int*)arg);
    free(arg);
    handle_client(client_fd);
    return 0;
}

#else

static void* client_thread_worker(void* arg) {
    int client_fd = *((int*)arg);
    free(arg);
    handle_client(client_fd);
    return NULL;
}

#endif

int main(int argc, char **argv) {
    /* Parse --secure flag */
    int localhost_only = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--secure") == 0) localhost_only = 1;
    }

    /* Initialize security subsystem */
    zcc_auth_init("config/auth.key");

    int server_fd = init_server_socket(PORT, localhost_only);

    printf("========================================================\n");
    printf("   \x1b[36mZKAEDI VMAX MONOLITH ENGINE v2.5 — Hardened Server\x1b[0m\n");
    printf("========================================================\n");
    printf(" Server listening on \x1b[32mhttp://%s:%d\x1b[0m\n",
           localhost_only ? "127.0.0.1" : "0.0.0.0", PORT);
    printf(" Security mode: \x1b[33m%s\x1b[0m\n",
           localhost_only ? "LOCALHOST ONLY" : "ALL INTERFACES");
    printf(" Embedded assets: \x1b[35m%d files\x1b[0m\n", NUM_EMBEDDED_ASSETS);
    for (int i = 0; i < NUM_EMBEDDED_ASSETS; i++) {
        printf("   - %s (%u bytes)\n",
               embedded_assets[i]->filename,
               embedded_assets[i]->size_bytes);
    }
    printf(" Path traversal guard: \x1b[32mACTIVE\x1b[0m\n");
    printf(" Shell injection guard: \x1b[32mACTIVE\x1b[0m (safe_exec)\n");
    printf(" HMAC auth gate: \x1b[32mACTIVE\x1b[0m\n");
    printf(" Multi-threading: \x1b[32mACTIVE\x1b[0m\n");
    printf("========================================================\n\n");

    while (1) {
        int client_fd = accept_client_connection(server_fd);
        if (client_fd >= 0) {
            int* pclient = malloc(sizeof(int));
            if (pclient == NULL) {
                CLOSE_FD(client_fd);
                continue;
            }
            *pclient = client_fd;

#ifdef _WIN32
            HANDLE thread_handle = CreateThread(NULL, 0,
                client_thread_worker, pclient, 0, NULL);
            if (thread_handle == NULL) {
                fprintf(stderr, "CreateThread failed: %lu\n",
                        GetLastError());
                free(pclient);
                CLOSE_FD(client_fd);
            } else {
                CloseHandle(thread_handle);
            }
#else
            pthread_t thread_id;
            if (pthread_create(&thread_id, NULL,
                               client_thread_worker, pclient) != 0) {
                perror("pthread_create failed");
                free(pclient);
                CLOSE_FD(client_fd);
            } else {
                pthread_detach(thread_id);
            }
#endif
        }
    }

    return 0;
}
