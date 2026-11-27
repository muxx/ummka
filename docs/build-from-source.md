# Build from source

Use Node.js 26.13.1 with its bundled npm 11.20.0, and install Rust through rustup. The repository selects Rust 1.95.0, rustfmt and Clippy. Install the locked JavaScript dependencies from the root of the checkout.

```sh
npm ci
```

**macOS on Apple Silicon.** Install Xcode with the macOS SDK. CI uses Xcode 26.6. Run the checks and open the release bundle.

```sh
make check-macos
install_dir=$(mktemp -d)
ditto -x -k artifacts/ummka-macos-arm64.zip "$install_dir"
open "$install_dir/ummka.app"
```

The first run downloads pinned versions of actionlint, ShellCheck, Trivy and jq into `.check-tools/`. To keep the locally built app, move the extracted `ummka.app` to Applications in Finder. For live editing, run `npm run tauri -- dev`.

The GitHub Actions ZIP is a development build. Tauri signs the bundle ad hoc by default. To use an Apple signing identity configured on your Mac, set `APPLE_SIGNING_IDENTITY` before building. For an internet release outside the App Store, Gatekeeper expects a Developer ID–signed, notarized app. [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

**Android ARM64.** Install Temurin 17.0.21.1+2 and the Android SDK command-line tools. Set `ANDROID_HOME` to your SDK and `JAVA_HOME` to this JDK for the build. Install the SDK packages and the Rust target before building the APK.

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  'platforms;android-37.0' 'platforms;android-36' 'build-tools;36.0.0' \
  'ndk;28.2.13676358' 'platform-tools'
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
rustup target add aarch64-linux-android
make check-android-package
"$ANDROID_HOME/platform-tools/adb" install -r artifacts/ummka-android-arm64-debug.apk
```

The APK uses Gradle's local debug signing key. Open **ummka** from the launcher on an ARM64 device or emulator.

`make check-android` builds the APK and verifies the native HTTP client on a disposable Android API 36 emulator. The network tests use the system OpenSSL CLI to generate temporary certificates. Install the emulator and its system image, replacing `arm64-v8a` with `x86_64` on an x86_64 host. On x86_64, also run `rustup target add x86_64-linux-android`.

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'emulator' 'system-images;android-36;default;arm64-v8a'
make check-android
```

The network test builds a separate optimized APK and installs its temporary TLS root on that emulator. The same APK uses Android WebView to read a binary HTTPS response, cancel in-flight requests and check cleanup across a reload. Run `make check-android-http` to repeat both checks. On macOS, `make check-macos` exercises the same page in WKWebView and closes a hidden window with a pending request. The test root is limited to the test client on macOS. For the offline Android startup check, open the distributable APK twice in airplane mode, stopping its process between launches.

The macOS check validates the actual window that anchors AuthenticationServices. The GitHub-hosted macOS job also opens the native file picker and starts and cancels a browser session.

The frontend and its REST tests use the generated ES modules and TypeScript declarations in `vendor/mattermost/`. A native connection supplies the generated client's `basePath` and `fetchApi`. The platform checks call `SystemApi.getPing` over HTTPS at the server root and under a path prefix. After `npm ci`, run `npm test` or `npm run build`.

To verify the bindings, set `JAVA_HOME` to Temurin 17 and run `make check-contract`. It selects operations from the pinned Mattermost 10.10.1 sources, applies the verified history corrections, compares the generated files and tests requests against a local HTTP server. The native connection checks each request against `contracts/mattermost/operations.json`. The verified document is written to `artifacts/mattermost-v10.10.1.openapi.json`. When updating the contract, run `make generate-bindings` with rsync installed and review the generated changes. [History corrections](../scripts/contract/history-corrections.ts)

On a Mac with both native toolchains and Docker Compose, `make check` runs both builds and the contract and compatibility checks used in GitHub Actions. To test channel history on Mattermost 10.10.1 and 12.1.0, run `make -j2 check-mattermost` with Docker running. Each run creates its own private network, test accounts and sample messages. The dependency scan covers npm, Cargo and Gradle and writes its report to `artifacts/trivy.json`. The disposable macOS runner also opens the unpacked application twice with its network interface disabled.
