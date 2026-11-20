import UIKit
import Capacitor
import Vision
import CoreImage
import ImageIO
import Security

// The app's web view, with the plugins that live inside this app.
class WardrobeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CutoutPlugin())
        bridge?.registerPluginInstance(CloudStorePlugin())
        bridge?.registerPluginInstance(HapticsPlugin())
        bridge?.registerPluginInstance(PhotoPickerPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
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

    // Shared GPU-backed CIContext avoids per-call context allocation overhead.
    private static let ciContext = CIContext()

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
        guard let source = call.getString("image"), !source.isEmpty else {
            call.reject("Send the picture as a data URL in image.")
            return
        }
        guard #available(iOS 17.0, *) else {
            call.reject("This needs iOS 17 or later.")
            return
        }
        // Decode base64 and run Vision off the caller queue so large photos never block UI.
        DispatchQueue.global(qos: .userInitiated).async {
            guard let image = CutoutPlugin.decode(source), let cgImage = image.cgImage else {
                call.reject("Send the picture as a data URL in image.")
                return
            }
            let orientation = CutoutPlugin.cgOrientation(image.imageOrientation)
            do {
                if let png = try CutoutPlugin.lift(cgImage, orientation: orientation) {
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

    static func cgOrientation(_ orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }

    @available(iOS 17.0, *)
    static func lift(_ cgImage: CGImage, orientation: CGImagePropertyOrientation = .up) throws -> Data? {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        try handler.perform([request])
        guard let result = request.results?.first, !result.allInstances.isEmpty else { return nil }
        let buffer = try result.generateMaskedImage(ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
        let ciImage = CIImage(cvPixelBuffer: buffer)
        guard let output = CutoutPlugin.ciContext.createCGImage(ciImage, from: ciImage.extent) else { return nil }
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
        CAPPluginMethod(name: "settle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecret", returnType: CAPPluginReturnPromise)
    ]

    static let container = "iCloud.com.njarrar.wardrobe"
    static let keychainService = "com.njarrar.wardrobe.closet"

    // `work` serializes access to `rootURL`, `localURL`, `usesICloud` and file coordination.
    // Downloads wait asynchronously on `downloadQueue` so `work` is never stalled.
    private let work = DispatchQueue(label: "wardrobe.cloudstore")
    private let downloadQueue = DispatchQueue(label: "wardrobe.cloudstore.download", qos: .utility, attributes: .concurrent)
    private var rootURL: URL?
    private var localURL: URL?
    private var usesICloud = false

    // Main-queue state for the iCloud metadata query and debounced change notifications.
    private var query: NSMetadataQuery?
    private var listed = false
    private var waiting: [() -> Void] = []
    private var debounceWorkItem: DispatchWorkItem?
    private var identityObserver: NSObjectProtocol?

    override public func load() {
        super.load()
        identityObserver = NotificationCenter.default.addObserver(
            forName: .NSUbiquityIdentityDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleUbiquityIdentityChange()
        }
    }

    deinit {
        if let observer = identityObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        NotificationCenter.default.removeObserver(self)
        debounceWorkItem?.cancel()
        if let activeQuery = query {
            DispatchQueue.main.async {
                activeQuery.stop()
            }
        }
    }

    private func handleUbiquityIdentityChange() {
        work.async { [weak self] in
            guard let self else { return }
            self.rootURL = nil
            self.usesICloud = false
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.query?.stop()
                if let activeQuery = self.query {
                    NotificationCenter.default.removeObserver(self, name: .NSMetadataQueryDidFinishGathering, object: activeQuery)
                    NotificationCenter.default.removeObserver(self, name: .NSMetadataQueryDidUpdate, object: activeQuery)
                }
                self.query = nil
                self.listed = false
                self.notifyListeners("changed", data: [:])
            }
        }
    }

    // Must be called on `work`.
    private func resolveRoot() -> (url: URL, isICloud: Bool) {
        if let rootURL { return (rootURL, usesICloud) }
        let files = FileManager.default
        let url: URL
        if let cloud = files.url(forUbiquityContainerIdentifier: CloudStorePlugin.container) {
            url = cloud.appendingPathComponent("Documents/Closet", isDirectory: true)
            usesICloud = true
        } else {
            url = files.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Closet", isDirectory: true)
            usesICloud = false
        }
        try? files.createDirectory(at: url, withIntermediateDirectories: true)
        rootURL = url
        return (url, usesICloud)
    }

    // Imports in progress stay on this device. They are short lived and
    // would only cause clashes in iCloud. Must be called on `work`.
    private func localRoot() -> URL {
        if let localURL { return localURL }
        let files = FileManager.default
        let url = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Closet", isDirectory: true)
        try? files.createDirectory(at: url, withIntermediateDirectories: true)
        localURL = url
        return url
    }

    // Runs `done` once iCloud has listed the folder, or after 20 seconds.
    private func whenListed(_ done: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.listed { done(); return }
            self.waiting.append(done)
            if self.query != nil { return }
            let query = NSMetadataQuery()
            query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
            query.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
            NotificationCenter.default.addObserver(self, selector: #selector(self.listingDone), name: .NSMetadataQueryDidFinishGathering, object: query)
            NotificationCenter.default.addObserver(self, selector: #selector(self.listingChanged), name: .NSMetadataQueryDidUpdate, object: query)
            self.query = query
            query.start()
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                self?.listingDone()
            }
        }
    }

    @objc private func listingDone() {
        if listed { return }
        listed = true
        let pending = waiting
        waiting = []
        pending.forEach { $0() }
    }

    @objc private func listingChanged() {
        debounceWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.notifyListeners("changed", data: [:])
        }
        debounceWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: item)
    }

    // Must be called on `work`.
    private func resolveFileTarget(_ call: CAPPluginCall) -> (url: URL, isICloud: Bool)? {
        guard let path = call.getString("path"), !path.isEmpty, !path.hasPrefix("/"),
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            call.reject("Bad path")
            return nil
        }
        if path == "jobs.json" || path.hasPrefix("jobs/") {
            return (localRoot().appendingPathComponent(path), false)
        }
        let resolved = resolveRoot()
        return (resolved.url.appendingPathComponent(path), resolved.isICloud)
    }

    // Checks both file existence and iOS 16+/17+ APFS dataless download state.
    private static func isLocallyAvailable(_ url: URL, isICloud: Bool) -> Bool {
        let files = FileManager.default
        guard files.fileExists(atPath: url.path) else { return false }
        guard isICloud else { return true }
        // A fresh URL with no cached values, so each poll sees the real status.
        var fresh = URL(fileURLWithPath: url.path)
        fresh.removeAllCachedResourceValues()
        if let values = try? fresh.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
           let status = values.ubiquitousItemDownloadingStatus {
            return status == .current || status == .downloaded
        }
        return true
    }

    // Asks iCloud for every file that is only in the cloud so far (both legacy
    // `.icloud` placeholders and modern iOS 16+/17+ APFS dataless files).
    private func downloadAll(root: URL, isICloud: Bool) {
        guard isICloud else { return }
        let keys: [URLResourceKey] = [.ubiquitousItemDownloadingStatusKey]
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys) else { return }
        for case let url as URL in walker {
            if url.lastPathComponent.hasPrefix(".") && url.pathExtension == "icloud" {
                var name = url.deletingPathExtension().lastPathComponent
                name.removeFirst()
                let target = url.deletingLastPathComponent().appendingPathComponent(name)
                try? FileManager.default.startDownloadingUbiquitousItem(at: target)
                continue
            }
            if let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
               values.ubiquitousItemDownloadingStatus == .notDownloaded {
                try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            }
        }
    }

    // Waits asynchronously off `work` until an iCloud item is locally materialized
    // (or times out after 15 seconds) without blocking other reads or writes.
    private func ensureDownloaded(url: URL, isICloud: Bool, completion: @escaping (Bool) -> Void) {
        if CloudStorePlugin.isLocallyAvailable(url, isICloud: isICloud) {
            completion(true)
            return
        }
        guard isICloud else {
            completion(false)
            return
        }
        downloadQueue.async { [weak self] in
            guard let self else { completion(false); return }
            let files = FileManager.default
            let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
            let hasLocalStub = files.fileExists(atPath: url.path) || files.fileExists(atPath: placeholder.path)
            if !hasLocalStub {
                do {
                    try files.startDownloadingUbiquitousItem(at: url)
                } catch {
                    completion(false)
                    return
                }
            } else {
                try? files.startDownloadingUbiquitousItem(at: url)
            }
            self.pollDownload(url: url, remaining: 150, completion: completion)
        }
    }

    private func pollDownload(url: URL, remaining: Int, completion: @escaping (Bool) -> Void) {
        if CloudStorePlugin.isLocallyAvailable(url, isICloud: true) {
            completion(true)
            return
        }
        if remaining <= 0 {
            completion(false)
            return
        }
        downloadQueue.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { completion(false); return }
            self.pollDownload(url: url, remaining: remaining - 1, completion: completion)
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        work.async { [weak self] in
            guard let self else { return }
            let resolved = self.resolveRoot()
            _ = self.localRoot()
            guard resolved.isICloud else {
                call.resolve(["root": resolved.url.path, "icloud": false])
                return
            }
            self.whenListed { [weak self] in
                guard let self else { return }
                call.resolve(["root": resolved.url.path, "icloud": true])
                self.downloadQueue.async { [weak self] in
                    self?.downloadAll(root: resolved.url, isICloud: true)
                }
            }
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        let wantConflicts = call.getBool("conflicts") == true
        work.async { [weak self] in
            guard let self, let target = self.resolveFileTarget(call) else { return }
            self.ensureDownloaded(url: target.url, isICloud: target.isICloud) { [weak self] available in
                guard let self else { return }
                guard available else {
                    // Only a file with no copy and no iCloud stub is missing. One that
                    // is still on its way must not read as an empty closet.
                    let files = FileManager.default
                    let placeholder = target.url.deletingLastPathComponent().appendingPathComponent(".\(target.url.lastPathComponent).icloud")
                    if files.fileExists(atPath: target.url.path) || files.fileExists(atPath: placeholder.path) {
                        call.reject("This file is still downloading from iCloud. Try again in a moment.")
                    } else {
                        call.resolve(["missing": true])
                    }
                    return
                }
                self.work.async {
                    var result: Data?
                    var readError: Error?
                    var conflicts: [String] = []
                    var failure: NSError?
                    NSFileCoordinator().coordinate(readingItemAt: target.url, options: [], error: &failure) { readURL in
                        do {
                            result = try Data(contentsOf: readURL)
                        } catch {
                            readError = error
                            return
                        }
                        if target.isICloud, wantConflicts,
                           let versions = NSFileVersion.unresolvedConflictVersionsOfItem(at: readURL) {
                            for version in versions {
                                if let data = try? Data(contentsOf: version.url) {
                                    conflicts.append(data.base64EncodedString())
                                }
                            }
                        }
                    }
                    if let failure {
                        call.reject("Could not read \(target.url.lastPathComponent): \(failure.localizedDescription)")
                        return
                    }
                    if let readError {
                        let nsError = readError as NSError
                        if nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileReadNoSuchFileError {
                            call.resolve(["missing": true])
                            return
                        }
                        call.reject("Could not read \(target.url.lastPathComponent): \(readError.localizedDescription)")
                        return
                    }
                    guard let result else {
                        call.reject("Could not read \(target.url.lastPathComponent)")
                        return
                    }
                    call.resolve(["data": result.base64EncodedString(), "conflicts": conflicts])
                }
            }
        }
    }

    // Tells iCloud the copies of a file have been joined, inside NSFileCoordinator.
    @objc func settle(_ call: CAPPluginCall) {
        work.async { [weak self] in
            guard let self, let target = self.resolveFileTarget(call) else { return }
            guard target.isICloud else { call.resolve(); return }
            var failure: NSError?
            var settleError: Error?
            NSFileCoordinator().coordinate(writingItemAt: target.url, options: .forReplacing, error: &failure) { writeURL in
                if let versions = NSFileVersion.unresolvedConflictVersionsOfItem(at: writeURL), !versions.isEmpty {
                    for version in versions { version.isResolved = true }
                    do {
                        try NSFileVersion.removeOtherVersionsOfItem(at: writeURL)
                    } catch {
                        settleError = error
                    }
                }
            }
            if let failure {
                call.reject("Could not settle \(target.url.lastPathComponent): \(failure.localizedDescription)")
            } else if let settleError {
                call.reject("Could not settle \(target.url.lastPathComponent): \(settleError.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }

    // Brings one file down from iCloud, for a picture that is not on this
    // device yet. Runs off the main work queue so reads do not wait on it.
    @objc func download(_ call: CAPPluginCall) {
        work.async { [weak self] in
            guard let self, let target = self.resolveFileTarget(call) else { return }
            self.ensureDownloaded(url: target.url, isICloud: target.isICloud) { ready in
                call.resolve(["ready": ready])
            }
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let text = call.getString("data"), let data = Data(base64Encoded: text) else {
            call.reject("Send data as base64")
            return
        }
        work.async { [weak self] in
            guard let self, let target = self.resolveFileTarget(call) else { return }
            do {
                try FileManager.default.createDirectory(at: target.url.deletingLastPathComponent(), withIntermediateDirectories: true)
            } catch {
                call.reject("Could not create folder for \(target.url.lastPathComponent): \(error.localizedDescription)")
                return
            }
            var writeError: Error?
            var failure: NSError?
            NSFileCoordinator().coordinate(writingItemAt: target.url, options: .forReplacing, error: &failure) { writeURL in
                do {
                    try data.write(to: writeURL, options: .atomic)
                } catch {
                    writeError = error
                }
            }
            if let failure {
                call.reject("Could not save \(target.url.lastPathComponent): \(failure.localizedDescription)")
            } else if let writeError {
                call.reject("Could not save \(target.url.lastPathComponent): \(writeError.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        work.async { [weak self] in
            guard let self, let target = self.resolveFileTarget(call) else { return }
            var failure: NSError?
            var removeError: Error?
            NSFileCoordinator().coordinate(writingItemAt: target.url, options: .forDeleting, error: &failure) { deleteURL in
                do {
                    try FileManager.default.removeItem(at: deleteURL)
                } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
                    // Already removed.
                } catch {
                    removeError = error
                }
            }
            if let failure {
                call.reject("Could not remove \(target.url.lastPathComponent): \(failure.localizedDescription)")
            } else if let removeError {
                call.reject("Could not remove \(target.url.lastPathComponent): \(removeError.localizedDescription)")
            } else {
                call.resolve()
            }
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
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
        } else {
            call.reject("Keychain read failed (\(status))")
        }
    }

    @objc func setSecret(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.reject("key is required"); return }
        let query = keychainQuery(key)
        guard let value = call.getString("value"), !value.isEmpty, let data = value.data(using: .utf8) else {
            let status = SecItemDelete(query as CFDictionary)
            if status == errSecSuccess || status == errSecItemNotFound {
                call.resolve()
            } else {
                call.reject("Keychain delete failed (\(status))")
            }
            return
        }
        // Update in place first so an error never wipes an existing secret.
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            call.resolve()
        } else if updateStatus == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            if addStatus == errSecSuccess {
                call.resolve()
            } else {
                call.reject("Keychain add failed (\(addStatus))")
            }
        } else {
            call.reject("Keychain update failed (\(updateStatus))")
        }
    }
}
