import UIKit
import Capacitor
import Vision
import CoreImage

// The app's web view, with the plugins that live inside this app.
class WardrobeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CutoutPlugin())
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
