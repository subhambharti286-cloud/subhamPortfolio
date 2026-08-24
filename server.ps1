$csharp = @'
using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Collections.Generic;

public class HighPerfServer {
    private HttpListener listener;
    private string root;
    private Dictionary<string, string> mimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".svg", "image/svg+xml" },
        { ".json", "application/json" },
        { ".ico", "image/x-icon" },
        { ".mp4", "video/mp4" },
        { ".webm", "video/webm" },
        { ".mov", "video/quicktime" }
    };

    public void Start(int[] ports, string rootDir) {
        root = rootDir;
        listener = new HttpListener();
        
        foreach (int port in ports) {
            try {
                listener.Prefixes.Add(string.Format("http://localhost:{0}/", port));
                listener.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", port));
            } catch {}
        }

        listener.Start();
        
        foreach (int port in ports) {
            Console.WriteLine(string.Format("Server listening at http://localhost:{0}/", port));
        }

        while (listener.IsListening) {
            try {
                var context = listener.GetContext();
                ThreadPool.QueueUserWorkItem(new WaitCallback(ProcessRequest), context);
            } catch {
                if (!listener.IsListening) break;
            }
        }
    }

    private void ProcessRequest(object state) {
        HttpListenerContext context = (HttpListenerContext)state;
        try {
            var request = context.Request;
            var response = context.Response;
            string rawPath = request.Url.LocalPath.TrimStart('/');
            if (string.IsNullOrEmpty(rawPath)) {
                rawPath = "index.html";
            }
            rawPath = Uri.UnescapeDataString(rawPath);
            string fullPath = Path.Combine(root, rawPath.Replace('/', Path.DirectorySeparatorChar));

            if (File.Exists(fullPath)) {
                string ext = Path.GetExtension(fullPath);
                string mime;
                if (mimeTypes.TryGetValue(ext, out mime)) {
                    response.ContentType = mime;
                } else {
                    response.ContentType = "application/octet-stream";
                }

                response.AddHeader("Accept-Ranges", "bytes");

                if (string.Equals(ext, ".png", StringComparison.OrdinalIgnoreCase) || 
                    string.Equals(ext, ".jpg", StringComparison.OrdinalIgnoreCase) || 
                    string.Equals(ext, ".jpeg", StringComparison.OrdinalIgnoreCase)) {
                    response.AddHeader("Cache-Control", "public, max-age=86400");
                } else {
                    response.AddHeader("Cache-Control", "no-cache");
                }

                using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                    long totalLength = fs.Length;
                    long start = 0;
                    long end = totalLength - 1;

                    string rangeHeader = request.Headers["Range"];
                    if (!string.IsNullOrEmpty(rangeHeader) && rangeHeader.StartsWith("bytes=")) {
                        string[] range = rangeHeader.Substring(6).Split('-');
                        if (!string.IsNullOrEmpty(range[0])) {
                            start = Convert.ToInt64(range[0]);
                        }
                        if (range.Length > 1 && !string.IsNullOrEmpty(range[1])) {
                            end = Convert.ToInt64(range[1]);
                        }
                        if (start > end || start >= totalLength) {
                            response.StatusCode = 416;
                            response.AddHeader("Content-Range", string.Format("bytes */{0}", totalLength));
                            return;
                        }
                        response.StatusCode = 206;
                        response.AddHeader("Content-Range", string.Format("bytes {0}-{1}/{2}", start, end, totalLength));
                    } else {
                        response.StatusCode = 200;
                    }

                    long lengthToSend = end - start + 1;
                    response.ContentLength64 = lengthToSend;
                    fs.Seek(start, SeekOrigin.Begin);

                    byte[] buffer = new byte[65536];
                    long bytesRemaining = lengthToSend;
                    while (bytesRemaining > 0) {
                        int bytesToRead = (int)Math.Min((long)buffer.Length, bytesRemaining);
                        int bytesRead = fs.Read(buffer, 0, bytesToRead);
                        if (bytesRead == 0) break;
                        response.OutputStream.Write(buffer, 0, bytesRead);
                        bytesRemaining -= bytesRead;
                    }
                }
            } else {
                response.StatusCode = 404;
                byte[] notFound = System.Text.Encoding.UTF8.GetBytes(string.Format("404 Not Found: {0}", rawPath));
                response.ContentLength64 = notFound.Length;
                response.OutputStream.Write(notFound, 0, notFound.Length);
            }
        } catch {
        } finally {
            try { context.Response.OutputStream.Close(); } catch { }
        }
    }
}
'@

Add-Type -TypeDefinition $csharp -Language CSharp
$srv = New-Object HighPerfServer
$root = "C:\Users\acer\.gemini\antigravity\scratch\scroll-animation"
$ports = [int[]]@(8080, 3000)
$srv.Start($ports, $root)
