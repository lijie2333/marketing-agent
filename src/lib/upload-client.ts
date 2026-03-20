export interface UploadResult {
  url: string;
}

interface UploadResponse extends Partial<UploadResult> {
  error?: string;
}

interface UploadFileWithProgressOptions {
  endpoint?: string;
  file: File;
  onProgress?: (progress: number) => void;
}

function parseUploadResponse(xhr: XMLHttpRequest): UploadResponse {
  if (xhr.response && typeof xhr.response === "object") {
    return xhr.response as UploadResponse;
  }

  if (!xhr.responseText) {
    return {};
  }

  try {
    return JSON.parse(xhr.responseText) as UploadResponse;
  } catch {
    return {};
  }
}

export function uploadFileWithProgress({
  endpoint = "/api/upload",
  file,
  onProgress,
}: UploadFileWithProgressOptions): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", endpoint);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });

    xhr.addEventListener("load", () => {
      const response = parseUploadResponse(xhr);

      if (xhr.status >= 200 && xhr.status < 300 && response.url) {
        onProgress?.(100);
        resolve({ url: response.url });
        return;
      }

      reject(new Error(response.error || `上传失败 (${xhr.status})`));
    });

    xhr.addEventListener("error", () => {
      reject(new Error("网络异常，上传失败"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("上传已取消"));
    });

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
