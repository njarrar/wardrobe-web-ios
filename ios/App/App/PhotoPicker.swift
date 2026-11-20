import UIKit
import Capacitor
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

// The system photo picker. Each picked photo is made smaller here, one at a
// time, and saved as a JPEG in the app's temp folder, so many large photos
// never sit in the web view's memory at once.
@objc(PhotoPickerPlugin)
public class PhotoPickerPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "PhotoPickerPlugin"
    public let jsName = "PhotoPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    static let longestSide = 2048
    private var pending: CAPPluginCall?
    private let work = DispatchQueue(label: "wardrobe.photopicker")

    @objc func pick(_ call: CAPPluginCall) {
        let limit = max(1, min(30, call.getInt("limit") ?? 20))
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else { call.reject("No screen to show the picker on."); return }
            if let earlier = self.pending { earlier.resolve(["files": []]) }
            self.pending = call
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = limit
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pending else { return }
        pending = nil
        if results.isEmpty { call.resolve(["files": []]); return }
        work.async {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("picked-photos", isDirectory: true)
            try? FileManager.default.removeItem(at: folder)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var files: [[String: Any]] = []
            var failed = 0
            for (index, result) in results.enumerated() {
                let provider = result.itemProvider
                guard provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else { failed += 1; continue }
                let done = DispatchSemaphore(value: 0)
                var saved: URL?
                // The system hands over a file that lives only inside this
                // call, so the smaller copy is made right here.
                provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
                    defer { done.signal() }
                    guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return }
                    let options: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: PhotoPickerPlugin.longestSide
                    ]
                    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return }
                    guard let data = UIImage(cgImage: image).jpegData(compressionQuality: 0.88) else { return }
                    let target = folder.appendingPathComponent("photo-\(index + 1).jpg")
                    if (try? data.write(to: target, options: .atomic)) != nil { saved = target }
                }
                _ = done.wait(timeout: .now() + 60)
                if let saved { files.append(["path": saved.absoluteString, "name": saved.lastPathComponent]) } else { failed += 1 }
            }
            call.resolve(["files": files, "failed": failed])
        }
    }
}
