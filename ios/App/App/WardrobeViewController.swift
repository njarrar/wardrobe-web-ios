import UIKit
import Capacitor
import Vision
import CoreImage
import Security

// The app's web view, with the plugins that live inside this app.
class WardrobeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CutoutPlugin())
        bridge?.registerPluginInstance(CloudStorePlugin())
    }
}

// Lifts the main subject out of a picture with Apple's Vision framework.
// Runs fully on the device (iOS 17 or later). Nothing leaves the phone.
@objc(CutoutPlugin)
public class CutoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CutoutPlugin"
    public let jsName = "Cutout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cutOut", returnType: CAPPluginReturnPromise)
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            #if targetEnvironment(simulator)
            call.resolve(["available": false])
            #else
            call.resolve(["available": true])
            #endif
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func cutOut(_ call: CAPPluginCall) {
        guard let source = call.getString("image"), let image = CutoutPlugin.decode(source), let cgImage = image.cgImage else {
            call.reject("Send the picture as a data URL in image.")
            return
        }
        guard #available(iOS 17.0, *) else {
            call.reject("This needs iOS 17 or later.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if let png = try CutoutPlugin.lift(cgImage) {
                    call.resolve(["image": "data:image/png;base64," + png.base64EncodedString()])
                } else {
                    call.resolve([:])
                }
            } catch {
                call.reject("The cutout did not work: \(error.localizedDescription)")
            }
        }
    }

    static func decode(_ dataUrl: String) -> UIImage? {
        let base64 = dataUrl.range(of: "base64,").map { String(dataUrl[$0.upperBound...]) } ?? dataUrl
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)
    }

    @available(iOS 17.0, *)
    static func lift(_ cgImage: CGImage) throws -> Data? {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        try handler.perform([request])
        guard let result = request.results?.first, !result.allInstances.isEmpty else { return nil }
        let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
        let ciImage = CIImage(cvPixelBuffer: buffer)
        let context = CIContext()
        guard let output = context.createCGImage(ciImage, from: ciImage.extent) else { return nil }
        return UIImage(cgImage: output).pngData()
    }
}

// The closet's files when there is no server: the app's own iCloud Drive
// folder (hidden from the Files app), or the device when iCloud is off.
// AI keys go in the Keychain, synced by iCloud Keychain.
@objc(CloudStorePlugin)
public class CloudStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudStorePlugin"
    public let jsName = "CloudStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecret", returnType: CAPPluginReturnPromise)
    ]

    static let container = "iCloud.com.njarrar.wardrobe"
    static let keychainService = "com.njarrar.wardrobe.closet"
    private let work = DispatchQueue(label: "wardrobe.cloudstore")
    private var rootURL: URL?
    private var usesICloud = false

    private func root() -> URL {
        if let rootURL { return rootURL }
        let files = FileManager.default
        let url: URL
        if let cloud = files.url(forUbiquityContainerIdentifier: CloudStorePlugin.container) {
            url = cloud.appendingPathComponent("Documents/Closet", isDirectory: true)
            usesICloud = true
        } else {
            url = files.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Closet", isDirectory: true)
        }
        try? files.createDirectory(at: url, withIntermediateDirectories: true)
        rootURL = url
        return url
    }

    private func fileURL(_ call: CAPPluginCall) -> URL? {
        guard let path = call.getString("path"), !path.isEmpty, !path.hasPrefix("/"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            call.reject("Bad path")
            return nil
        }
        return root().appendingPathComponent(path)
    }

    // Asks iCloud for every file that is only in the cloud so far, so
    // pictures open without a wait later.
    private func downloadAll() {
        guard usesICloud, let walker = FileManager.default.enumerator(at: root(), includingPropertiesForKeys: nil) else { return }
        for case let url as URL in walker where url.lastPathComponent.hasPrefix(".") && url.pathExtension == "icloud" {
            var name = url.deletingPathExtension().lastPathComponent
            name.removeFirst()
            try? FileManager.default.startDownloadingUbiquitousItem(at: url.deletingLastPathComponent().appendingPathComponent(name))
        }
    }

    private func waitForDownload(_ url: URL) -> Bool {
        let files = FileManager.default
        if files.fileExists(atPath: url.path) { return true }
        guard usesICloud else { return false }
        let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
        guard files.fileExists(atPath: placeholder.path) else { return false }
        try? files.startDownloadingUbiquitousItem(at: url)
        for _ in 0..<150 {
            if files.fileExists(atPath: url.path) { return true }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return files.fileExists(atPath: url.path)
    }

    @objc func info(_ call: CAPPluginCall) {
        work.async {
            let url = self.root()
            call.resolve(["root": url.path, "icloud": self.usesICloud])
            self.downloadAll()
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        work.async {
            guard let url = self.fileURL(call) else { return }
            guard self.waitForDownload(url) else { call.resolve(["missing": true]); return }
            var result: Data?
            var failure: NSError?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { readURL in
                result = try? Data(contentsOf: readURL)
            }
            if let result { call.resolve(["data": result.base64EncodedString()]) }
            else { call.reject("Could not read \(url.lastPathComponent)") }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        work.async {
            guard let url = self.fileURL(call) else { return }
            guard let text = call.getString("data"), let data = Data(base64Encoded: text) else { call.reject("Send data as base64"); return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var saved = false
            var failure: NSError?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &failure) { writeURL in
                saved = (try? data.write(to: writeURL, options: .atomic)) != nil
            }
            if saved { call.resolve() } else { call.reject("Could not save \(url.lastPathComponent)") }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        work.async {
            guard let url = self.fileURL(call) else { return }
            var failure: NSError?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &failure) { deleteURL in
                try? FileManager.default.removeItem(at: deleteURL)
            }
            call.resolve()
        }
    }

    private func keychainQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: CloudStorePlugin.keychainService,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: kCFBooleanTrue as Any
        ]
    }

    @objc func getSecret(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key is required"); return }
        var query = keychainQuery(key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func setSecret(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key is required"); return }
        let query = keychainQuery(key)
        SecItemDelete(query as CFDictionary)
        guard let value = call.getString("value"), let data = value.data(using: .utf8) else { call.resolve(); return }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess { call.resolve() } else { call.reject("Keychain said \(status)") }
    }
}
