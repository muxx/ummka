export PATH := $(CURDIR)/.check-tools:$(PATH)

.PHONY: check check-macos check-android check-android-package check-android-http check-contract generate-bindings check-mattermost check-mattermost-10.10.1 check-mattermost-12.1.0
check: check-macos check-android check-contract check-mattermost

check-mattermost: check-mattermost-10.10.1 check-mattermost-12.1.0

check-mattermost-10.10.1 check-mattermost-12.1.0:
	sh scripts/check-mattermost.sh $(@:check-mattermost-%=%)

check-contract:
	sh scripts/check-contract.sh

generate-bindings:
	sh scripts/check-contract.sh --write-bindings

.check-tools/installed: scripts/install-check-tools.sh
	sh scripts/install-check-tools.sh
	touch $@

check-macos: .check-tools/installed
	.check-tools/actionlint -shellcheck .check-tools/shellcheck
	.check-tools/shellcheck scripts/*.sh
	npm run lint
	npm run unused
	npm test
	npm run tauri -- build --bundles app -- --locked
	cd src-tauri && cargo fmt --all -- --check
	cd src-tauri && cargo clippy --all-targets --all-features --locked -- -D warnings
	cd src-tauri && cargo test --locked
	npm run test:native-http -- macos
	sh scripts/check-security.sh
	ditto -c -k --keepParent src-tauri/target/release/bundle/macos/ummka.app artifacts/ummka-macos-arm64.zip

check-android: check-android-package check-android-http

check-android-package:
	npm run tauri -- android build --debug --apk --target aarch64 -- --locked
	mkdir -p artifacts
	cp src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk artifacts/ummka-android-arm64-debug.apk
	"$(ANDROID_HOME)/build-tools/36.0.0/apksigner" verify artifacts/ummka-android-arm64-debug.apk

check-android-http:
	node --test scripts/native-http/android-webview.test.ts
	npm run test:native-http -- android
