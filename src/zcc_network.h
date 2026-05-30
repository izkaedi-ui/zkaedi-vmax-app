#ifndef ZCC_NETWORK_H
#define ZCC_NETWORK_H

/*
 * Initialize a TCP server socket on the given port.
 * If localhost_only is non-zero, binds to 127.0.0.1 instead of 0.0.0.0.
 * Returns the server file descriptor.
 */
int init_server_socket(int port, int localhost_only);

/*
 * Accept a single client connection. Returns the client fd, or -1 on error.
 */
int accept_client_connection(int server_fd);

#endif /* ZCC_NETWORK_H */
