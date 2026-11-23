# ummka app icons

Edit the [Night Aurora SVG](night-aurora.svg) for the full app icon. The [1024 × 1024 PNG](night-aurora.png) is its flat export.

| Platform | Assets |
| --- | --- |
| macOS | Tauri packages the [ICNS](macos/icon.icns). The [iconset](macos/Ummka.iconset/) contains the standard and Retina sizes used for export and the repository header. |
| Android | The launcher reads the [Android resources](../gen/android/app/src/main/res/). They include legacy and round icons, adaptive layers for API 26 and a monochrome layer for themed icons on API 33 and later. The [editable layers](android/layers/) and [Google Play artwork](android/google-play-512.png) live here. |
| iOS and iPadOS | The [app icon catalog](ios/AppIcon.appiconset/) contains iPhone, iPad and App Store slots for Xcode. |
| Apple Icon Composer | Open [Ummka.icon](apple/Ummka.icon/) to edit the bear and sky layers. The [vector background](apple/night-aurora-background.svg) is available separately. |
| Windows | The [ICO](windows/icon.ico) contains sizes from 16 to 256 px. The [AppX assets](windows/appx/) include the square and store logos. |
| Linux | The [hicolor directory](linux/hicolor/) contains raster sizes and scalable color and symbolic icons. |

The [standalone symbols](symbols/) include the bear in color, a small-size variant and a monochrome version, with [PNG exports](symbols/png/).
