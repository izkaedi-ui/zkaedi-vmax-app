#ifndef ZCC_SECURITY_H
#define ZCC_SECURITY_H

#include <time.h>

/*
 * ZCC Security Module
 * -------------------
 * Path sanitization, shell-free process execution,
 * HMAC bearer token validation, and per-IP rate limiting.
 */

/* Maximum length of an HMAC key (hex string) */
#define ZCC_AUTH_KEY_MAX 128

/* Rate limiter window (seconds) and max requests per window */
#define ZCC_RATE_WINDOW_SEC  1
#define ZCC_RATE_MAX_PER_WIN 16

/* Maximum tracked IPs for rate limiter */
#define ZCC_RATE_BUCKET_MAX  256

/* ---- Path Validation ---- */

/*
 * Returns 0 if the path is safe to serve, -1 if it contains
 * traversal sequences (..), null bytes, or absolute references.
 */
int zcc_validate_path(const char *decoded_path);

/* ---- Shell-Free Process Execution ---- */

/*
 * Execute a child process WITHOUT invoking the shell.
 * argv[] must be NULL-terminated.  Returns the child exit code,
 * or -1 on fork/exec failure.
 *
 * On POSIX: fork() + execvp()
 * On Win32: CreateProcessW()
 */
int zcc_safe_exec(const char *const argv[]);

/* ---- HMAC Auth ---- */

/*
 * Load the pre-shared auth key from `path` into an internal buffer.
 * Returns 0 on success, -1 if the file is missing or empty.
 * If the file doesn't exist, generates a new 32-byte random hex key.
 */
int zcc_auth_init(const char *key_path);

/*
 * Validate the value of an X-ZCC-Auth header against the loaded key.
 * Returns 0 if the token matches, -1 otherwise.
 */
int zcc_auth_check(const char *token);

/*
 * Extract the value of header `name` from the raw HTTP request buffer.
 * Writes into `out` (up to out_len-1 chars, null-terminated).
 * Returns 0 if found, -1 if not present.
 */
int zcc_extract_header(const char *request, const char *name,
                       char *out, int out_len);

/* ---- Rate Limiter ---- */

typedef struct {
    unsigned int ip;         /* IPv4 in host order */
    int          count;
    time_t       window_start;
} ZccRateBucket;

/*
 * Check if `ip_addr` (dotted-quad string) is within rate limits.
 * Returns 0 if allowed, -1 if rate-limited (HTTP 429).
 */
int zcc_rate_check(const char *ip_addr);

#endif /* ZCC_SECURITY_H */
