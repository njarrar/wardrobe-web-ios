import UIKit
import Capacitor
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import WidgetKit

// Small taps you can feel, for buttons such as Wear this and Shuffle.
@objc(HapticsPlugin)
public class HapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HapticsPlugin"
    public let jsName = "Haptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tap", returnType: CAPPluginReturnPromise)
    ]

    @objc func tap(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "select":
                UISelectionFeedbackGenerator().selectionChanged()
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }
}

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

// Hands today's outfit to the Home Screen widget. The widget cannot read the
// web view, so the app saves a small copy in a folder both can open.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    static let group = "group.com.njarrar.wardrobe"
    private let work = DispatchQueue(label: "wardrobe.widget")

    private func folder() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetBridgePlugin.group)?.appendingPathComponent("widget", isDirectory: true)
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": folder() != nil])
    }

    // days: [{ day, title, line, pieces: [id] }], pictures: { id: dataUrl },
    // emptyText: what to show on a day with no outfit.
    @objc func update(_ call: CAPPluginCall) {
        let days = call.getArray("days") ?? []
        let pictures = call.getObject("pictures") ?? [:]
        let emptyText = call.getString("emptyText") ?? ""
        work.async {
            guard let folder = self.folder() else { call.resolve(["saved": false]); return }
            let files = FileManager.default
            try? files.createDirectory(at: folder, withIntermediateDirectories: true)
            var names: [String: String] = [:]
            var keep: Set<String> = ["today.json"]
            for (id, value) in pictures {
                guard let dataUrl = value as? String else { continue }
                let name = "piece-" + String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }).suffix(80) + ".png"
                if let image = CutoutPlugin.decode(dataUrl), let small = WidgetBridgePlugin.shrink(image, side: 300), let png = small.pngData() {
                    try? png.write(to: folder.appendingPathComponent(name), options: .atomic)
                    names[id] = name
                    keep.insert(name)
                }
            }
            var saved: [[String: Any]] = []
            for case let entry as [String: Any] in days {
                guard let day = entry["day"] as? String else { continue }
                let ids = (entry["pieces"] as? [Any])?.compactMap { $0 as? String } ?? []
                saved.append([
                    "day": day,
                    "title": entry["title"] as? String ?? "",
                    "line": entry["line"] as? String ?? "",
                    "pictures": ids.compactMap { names[$0] }
                ])
            }
            let body: [String: Any] = ["days": saved, "emptyText": emptyText]
            if let data = try? JSONSerialization.data(withJSONObject: body) {
                try? data.write(to: folder.appendingPathComponent("today.json"), options: .atomic)
            }
            for name in (try? files.contentsOfDirectory(atPath: folder.path)) ?? [] where !keep.contains(name) {
                try? files.removeItem(at: folder.appendingPathComponent(name))
            }
            if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
            call.resolve(["saved": true])
        }
    }

    static func shrink(_ image: UIImage, side: CGFloat) -> UIImage? {
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { return nil }
        let scale = min(1, side / longest)
        let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
