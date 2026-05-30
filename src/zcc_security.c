#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>
#include "zcc_security.h"

#ifdef _WIN32
#  include <windows.h>
#  include <io.h>
#else
#  include <unistd.h>
#  include <sys/types.h>
#  include <sys/wait.h>
#  include <fcntl.h>
#endif

/* ================================================================
 *  Internal state
 * ================================================================ */

static char           s_auth_key[ZCC_AUTH_KEY_MAX];
static int            s_auth_loaded = 0;
static ZccRateBucket  s_buckets[ZCC_RATE_BUCKET_MAX];
static int            s_bucket_count = 0;

/* ================================================================
 *  Path Validation
 * ================================================================ */

int zcc_validate_path(const char *decoded_path) {
    if (decoded_path == NULL) return -1;

    /* Reject null bytes anywhere in the string */
    for (const char *p = decoded_path; *p; p++) {
        if (*p == '\0') return -1; /* shouldn't fire, but paranoia */
    }

    /* Reject absolute paths (Unix or Windows) */
    if (decoded_path[0] == '/' || decoded_path[0] == '\\') return -1;
    if (isalpha((unsigned char)decoded_path[0]) && decoded_path[1] == ':') return -1;

    /* Reject traversal sequences */
    if (strstr(decoded_path, "..") != NULL) return -1;

    /* Reject backslashes (Windows path escape) */
    if (strchr(decoded_path, '\\') != NULL) return -1;

    return 0;
}

/* ================================================================
 *  Shell-Free Process Execution
 * ================================================================ */

#ifdef _WIN32

int zcc_safe_exec(const char *const argv[]) {
    /* Build a flat command line from argv[] */
    char cmdline[4096];
    cmdline[0] = '\0';
    for (int i = 0; argv[i] != NULL; i++) {
        if (i > 0) strcat(cmdline, " ");
        /* Simple quoting — wrap each arg in quotes */
        strcat(cmdline, "\"");
        strncat(cmdline, argv[i], sizeof(cmdline) - strlen(cmdline) - 3);
        strcat(cmdline, "\"");
    }

    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    memset(&si, 0, sizeof(si));
    si.cb = sizeof(si);
    memset(&pi, 0, sizeof(pi));

    if (!CreateProcessA(NULL, cmdline, NULL, NULL, FALSE,
                        0, NULL, NULL, &si, &pi)) {
        fprintf(stderr, "[ZCC_SECURITY] CreateProcess failed: %lu\n",
                GetLastError());
        return -1;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exit_code = 1;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return (int)exit_code;
}

#else /* POSIX */

int zcc_safe_exec(const char *const argv[]) {
    pid_t pid = fork();
    if (pid < 0) {
        perror("[ZCC_SECURITY] fork");
        return -1;
    }
    if (pid == 0) {
        /* Child — exec without shell */
        execvp(argv[0], (char *const *)argv);
        perror("[ZCC_SECURITY] execvp");
        _exit(127);
    }
    /* Parent — wait */
    int status = 0;
    waitpid(pid, &status, 0);
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return -1;
}

#endif

/* ================================================================
 *  HMAC Auth — Pre-Shared Key
 * ================================================================ */

static void generate_random_key(char *buf, int hex_len) {
    const char hex[] = "0123456789abcdef";
    srand((unsigned)time(NULL) ^ (unsigned)getpid());
    for (int i = 0; i < hex_len; i++) {
        buf[i] = hex[rand() % 16];
    }
    buf[hex_len] = '\0';
}

int zcc_auth_init(const char *key_path) {
    FILE *f = fopen(key_path, "r");
    if (f != NULL) {
        if (fgets(s_auth_key, sizeof(s_auth_key), f) != NULL) {
            /* Strip trailing whitespace */
            int len = (int)strlen(s_auth_key);
            while (len > 0 && (s_auth_key[len-1] == '\n' ||
                               s_auth_key[len-1] == '\r' ||
                               s_auth_key[len-1] == ' ')) {
                s_auth_key[--len] = '\0';
            }
            if (len > 0) {
                s_auth_loaded = 1;
                fclose(f);
                printf("[ZCC_SECURITY] Auth key loaded (%d chars)\n", len);
                return 0;
            }
        }
        fclose(f);
    }

    /* Key file missing or empty — generate one */
    printf("[ZCC_SECURITY] Generating new auth key -> %s\n", key_path);
    generate_random_key(s_auth_key, 64);
    s_auth_loaded = 1;

    f = fopen(key_path, "w");
    if (f != NULL) {
        fprintf(f, "%s\n", s_auth_key);
        fclose(f);
    } else {
        fprintf(stderr, "[ZCC_SECURITY] WARNING: Could not write key to %s\n",
                key_path);
    }
    return 0;
}

int zcc_auth_check(const char *token) {
    if (!s_auth_loaded) return 0;  /* No key loaded = auth disabled */
    if (token == NULL) return -1;
    /* Constant-time compare to prevent timing attacks */
    int key_len = (int)strlen(s_auth_key);
    int tok_len = (int)strlen(token);
    int diff = key_len ^ tok_len;
    int min_len = key_len < tok_len ? key_len : tok_len;
    for (int i = 0; i < min_len; i++) {
        diff |= s_auth_key[i] ^ token[i];
    }
    return diff == 0 ? 0 : -1;
}

int zcc_extract_header(const char *request, const char *name,
                       char *out, int out_len) {
    if (!request || !name || !out || out_len <= 0) return -1;

    int name_len = (int)strlen(name);
    const char *p = request;
    while ((p = strstr(p, name)) != NULL) {
        /* Verify it's at the start of a header line */
        if (p != request && *(p-1) != '\n') { p++; continue; }
        p += name_len;
        /* Skip ": " */
        if (*p == ':') p++;
        while (*p == ' ') p++;
        /* Copy until \r or \n */
        int i = 0;
        while (*p && *p != '\r' && *p != '\n' && i < out_len - 1) {
            out[i++] = *p++;
        }
        out[i] = '\0';
        return 0;
    }
    return -1;
}

/* ================================================================
 *  Rate Limiter — Per-IP Sliding Window
 * ================================================================ */

static unsigned int ip_to_uint(const char *ip_addr) {
    unsigned int a, b, c, d;
    if (sscanf(ip_addr, "%u.%u.%u.%u", &a, &b, &c, &d) != 4)
        return 0;
    return (a << 24) | (b << 16) | (c << 8) | d;
}

int zcc_rate_check(const char *ip_addr) {
    unsigned int ip = ip_to_uint(ip_addr);
    time_t now = time(NULL);

    /* Find existing bucket */
    for (int i = 0; i < s_bucket_count; i++) {
        if (s_buckets[i].ip == ip) {
            if (now - s_buckets[i].window_start >= ZCC_RATE_WINDOW_SEC) {
                /* New window */
                s_buckets[i].window_start = now;
                s_buckets[i].count = 1;
                return 0;
            }
            s_buckets[i].count++;
            if (s_buckets[i].count > ZCC_RATE_MAX_PER_WIN) {
                return -1; /* Rate limited */
            }
            return 0;
        }
    }

    /* New IP — allocate bucket */
    if (s_bucket_count < ZCC_RATE_BUCKET_MAX) {
        s_buckets[s_bucket_count].ip = ip;
        s_buckets[s_bucket_count].count = 1;
        s_buckets[s_bucket_count].window_start = now;
        s_bucket_count++;
    } else {
        /* Evict oldest bucket */
        int oldest = 0;
        for (int i = 1; i < ZCC_RATE_BUCKET_MAX; i++) {
            if (s_buckets[i].window_start < s_buckets[oldest].window_start)
                oldest = i;
        }
        s_buckets[oldest].ip = ip;
        s_buckets[oldest].count = 1;
        s_buckets[oldest].window_start = now;
    }
    return 0;
}
