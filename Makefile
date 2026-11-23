export PATH := $(CURDIR)/.check-tools:$(PATH)

.PHONY: check check-macos check-android check-contract
check: check-macos check-android check-contract

check-contract:
	sh scripts/check-contract.sh

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
	cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
	cd src-tauri && cargo test --locked
	sh scripts/check-security.sh
	ditto -c -k --keepParent src-tauri/target/release/bundle/macos/ummka.app artifacts/ummka-macos-arm64.zip

check-android:
	npm run tauri -- android build --debug --apk --target aarch64 -- --locked
	mkdir -p artifacts
	cp src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk artifacts/ummka-android-arm64-debug.apk
	"$(ANDROID_HOME)/build-tools/36.0.0/apksigner" verify artifacts/ummka-android-arm64-debug.apk
