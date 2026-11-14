package com.nexus.box;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A tiny web server on the box. Passengers' phones (on the same Wi-Fi / hotspot as the box) open it by
 * scanning the QR code: they join with their name, request songs, send photos and shout-outs, and use a remote.
 */
class PhoneServer {
    interface Handler {
        /** Returns a JSON reply, or null for 404. */
        String handle(String method, String path, String query, byte[] body);
    }

    private ServerSocket server;
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private volatile boolean running = false;
    private final byte[] page;
    private final Handler handler;
    int port = 0;

    PhoneServer(byte[] page, Handler handler) { this.page = page; this.handler = handler; }

    void start() {
        if (running) return;
        for (int p : new int[]{8080, 8081, 8088, 8090}) {
            try { server = new ServerSocket(p); port = p; break; } catch (Exception ignored) {}
        }
        if (server == null) return;
        running = true;
        Thread t = new Thread(() -> {
            while (running) {
                try { final Socket s = server.accept(); workers.execute(() -> serve(s)); } catch (Exception e) { if (!running) break; }
            }
        }, "nexus-phones");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        workers.shutdownNow();
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) break;
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(20000);
            InputStream in = s.getInputStream();
            String req = readLine(in);
            if (req == null) { s.close(); return; }
            String[] parts = req.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET", target = parts.length > 1 ? parts[1] : "/";
            int len = 0; String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0 && line.substring(0, c).trim().toLowerCase(Locale.US).equals("content-length")) {
                    try { len = Integer.parseInt(line.substring(c + 1).trim()); } catch (Exception ignored) {}
                }
            }
            if (len > 12 * 1024 * 1024) { reply(s, 413, "application/json", "{\"ok\":false,\"error\":\"too big\"}".getBytes(StandardCharsets.UTF_8)); return; }
            byte[] body = new byte[Math.max(0, len)];
            int got = 0;
            while (got < len) { int n = in.read(body, got, len - got); if (n < 0) break; got += n; }
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            if (path.equals("/") || path.equals("/index.html")) { reply(s, 200, "text/html; charset=utf-8", page); return; }
            if (path.startsWith("/api/")) {
                String out = handler.handle(method, path.substring(5), query, body);
                if (out == null) reply(s, 404, "application/json", "{\"ok\":false}".getBytes(StandardCharsets.UTF_8));
                else reply(s, 200, "application/json; charset=utf-8", out.getBytes(StandardCharsets.UTF_8));
                return;
            }
            reply(s, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            try { s.close(); } catch (Exception ignored) {}
        }
    }

    private static void reply(Socket s, int code, String type, byte[] data) {
        try {
            OutputStream o = s.getOutputStream();
            String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\nContent-Type: " + type +
                    "\r\nContent-Length: " + data.length + "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
            o.write(head.getBytes(StandardCharsets.UTF_8));
            o.write(data);
            o.flush();
        } catch (Exception ignored) {
        } finally {
            try { s.close(); } catch (Exception ignored) {}
        }
    }

    /** The box's addresses on the local network (Wi-Fi, hotspot, ethernet). Best guess first. */
    static List<String> addresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a.isLoopbackAddress() || a.getAddress().length != 4) continue;
                    String ip = a.getHostAddress();
                    if (!a.isSiteLocalAddress()) continue;
                    String n = ni.getName().toLowerCase(Locale.US);
                    if (n.startsWith("wlan") || n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("eth")) out.add(0, ip); else out.add(ip);
                }
            }
        } catch (Exception ignored) {}
        return out;
    }
}
