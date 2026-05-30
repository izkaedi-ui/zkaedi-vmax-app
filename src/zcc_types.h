#ifndef ZCC_TYPES_H
#define ZCC_TYPES_H

#ifndef ZCC_EMBEDDED_ASSET_STRUCT
#define ZCC_EMBEDDED_ASSET_STRUCT
typedef struct {
    const char* filename;
    const unsigned char* data;
    unsigned int size_bytes;
    const char* mime_type;
    unsigned long long checksum;
} ZccEmbeddedAsset;
#endif

#endif // ZCC_TYPES_H
