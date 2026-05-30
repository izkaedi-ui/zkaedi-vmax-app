#include <stdio.h>
#include <stdlib.h>
#include "zcc_network.h"

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "Ws2_32.lib")

static int s_wsa_initialized = 0;

static void ensure_wsa(void) {
    if (!s_wsa_initialized) {
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
            fprintf(stderr, "WSAStartup failed: %d\n", WSAGetLastError());
            exit(EXIT_FAILURE);
        }
        s_wsa_initialized = 1;
    }
}

int init_server_socket(int port, int localhost_only) {
    ensure_wsa();

    SOCKET server_fd;
    struct sockaddr_in address;
    int opt = 1;

    if ((server_fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)) == INVALID_SOCKET) {
        fprintf(stderr, "socket failed: %d\n", WSAGetLastError());
        exit(EXIT_FAILURE);
    }

    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = localhost_only ? htonl(INADDR_LOOPBACK) : INADDR_ANY;
    address.sin_port = htons((u_short)port);

    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) == SOCKET_ERROR) {
        fprintf(stderr, "bind failed: %d\n", WSAGetLastError());
        exit(EXIT_FAILURE);
    }

    if (listen(server_fd, 10) == SOCKET_ERROR) {
        fprintf(stderr, "listen failed: %d\n", WSAGetLastError());
        exit(EXIT_FAILURE);
    }

    return (int)server_fd;
}

int accept_client_connection(int server_fd) {
    struct sockaddr_in address;
    int addrlen = sizeof(address);
    SOCKET client_fd = accept((SOCKET)server_fd,
                               (struct sockaddr*)&address, &addrlen);
    if (client_fd == INVALID_SOCKET) {
        fprintf(stderr, "accept failed: %d\n", WSAGetLastError());
        return -1;
    }
    return (int)client_fd;
}

#else /* POSIX */

#include <unistd.h>
#include <arpa/inet.h>
#include <sys/socket.h>

int init_server_socket(int port, int localhost_only) {
    int server_fd;
    struct sockaddr_in address;
    int opt = 1;

    if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
        perror("socket failed");
        exit(EXIT_FAILURE);
    }

    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt))) {
        perror("setsockopt");
        exit(EXIT_FAILURE);
    }

    address.sin_family = AF_INET;
    address.sin_addr.s_addr = localhost_only ? htonl(INADDR_LOOPBACK) : INADDR_ANY;
    address.sin_port = htons(port);

    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) < 0) {
        perror("bind failed");
        exit(EXIT_FAILURE);
    }

    if (listen(server_fd, 10) < 0) {
        perror("listen");
        exit(EXIT_FAILURE);
    }

    return server_fd;
}

int accept_client_connection(int server_fd) {
    int client_fd;
    struct sockaddr_in address;
    int addrlen = sizeof(address);

    if ((client_fd = accept(server_fd, (struct sockaddr*)&address,
                            (socklen_t*)&addrlen)) < 0) {
        perror("accept");
        return -1;
    }
    return client_fd;
}

#endif
