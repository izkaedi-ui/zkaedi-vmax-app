#define COBJMACROS
#include <windows.h>
#include <unknwn.h>
#include <WebView2.h>
HWND g_hWnd;
ICoreWebView2Controller* g_webController = NULL;
ICoreWebView2* g_webView = NULL;

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_SIZE:
            if (g_webController != NULL) {
                RECT bounds;
                GetClientRect(hWnd, &bounds);
                ICoreWebView2Controller_put_Bounds(g_webController, bounds);
            }
            break;
        case WM_DESTROY:
            PostQuitMessage(0);
            break;
        default:
            return DefWindowProc(hWnd, message, wParam, lParam);
    }
    return 0;
}
