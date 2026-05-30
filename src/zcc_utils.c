#include <string.h>
#include <ctype.h>
#include "zcc_utils.h"

void url_decode(char *dst, const char *src) {
    char a, b;
    while (*src) {
        if ((*src == '%') &&
            ((a = src[1]) && (b = src[2])) &&
            (isxdigit((unsigned char)a) && isxdigit((unsigned char)b))) {
            if (a >= 'a') a -= 'a' - 'A';
            if (a >= 'A') a -= 'A' - 10;
            else a -= '0';
            if (b >= 'a') b -= 'a' - 'A';
            if (b >= 'A') b -= 'A' - 10;
            else b -= '0';
            *dst++ = 16 * a + b;
            src += 3;
        } else if (*src == '+') {
            *dst++ = ' ';
            src++;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = '\0';
}

const char* get_mime_from_extension(const char* filepath) {
    if (strstr(filepath, ".html")) return "text/html";
    if (strstr(filepath, ".js")) return "text/javascript";
    if (strstr(filepath, ".css")) return "text/css";
    if (strstr(filepath, ".json")) return "application/json";
    if (strstr(filepath, ".glb")) return "model/gltf-binary";
    if (strstr(filepath, ".gltf")) return "model/gltf+json";
    if (strstr(filepath, ".png")) return "image/png";
    if (strstr(filepath, ".jpg") || strstr(filepath, ".jpeg")) return "image/jpeg";
    return "application/octet-stream";
}
