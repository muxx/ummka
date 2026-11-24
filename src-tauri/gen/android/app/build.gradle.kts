import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val httpCheck = providers.gradleProperty("ummkaNativeHttpCheck").orNull == "true"
if (httpCheck) {
    layout.buildDirectory.set(layout.projectDirectory.dir("build/native-http-check"))
}

android {
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    namespace = "io.github.muxx.ummka.dev"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "io.github.muxx.ummka.dev"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (httpCheck) {
                applicationIdSuffix = ".httpcheck"
                signingConfig = signingConfigs.getByName("debug")
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    if (httpCheck) {
        sourceSets.getByName("release") {
            manifest.srcFile("src/httpCheck/AndroidManifest.xml")
            java.srcDir("src/httpCheck/java")
            res.srcDir("src/httpCheck/res")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencyLocking {
    lockAllConfigurations()
}

tasks.matching { it.name == "assembleUniversalDebug" }.configureEach {
    finalizedBy("lintUniversalDebug")
}
if (httpCheck) {
    tasks.matching { it.name == "assembleUniversalRelease" }.configureEach {
        finalizedBy("lintUniversalRelease")
    }
}

// AGP resolves Lint and device-test utilities on their own JVM classpaths.
val androidToolVersions = configurations.dependencyScope("androidToolVersions")
configurations.matching { it.name == "androidLintTool" || it.name.startsWith("unified-test-platform-") }
    .configureEach { extendsFrom(androidToolVersions.get()) }

dependencies {
    val cargoLock = providers.fileContents(layout.projectDirectory.file("../../../Cargo.lock")).asText.get()
    val verifierVersion = Regex("""(?m)^name = "rustls-platform-verifier-android"\r?\nversion = "([^"]+)"$""")
        .find(cargoLock)?.groupValues?.get(1) ?: error("Missing Android verifier in Cargo.lock")
    implementation("org.rustls:rustls-platform-verifier:$verifierVersion")
    implementation(platform("com.fasterxml.jackson:jackson-bom:2.18.12"))
    add(androidToolVersions.name, platform("io.netty:netty-bom:4.1.141.Final"))
    constraints {
        add(androidToolVersions.name, "com.google.guava:guava:33.8.0-jre")
        add(androidToolVersions.name, "org.bouncycastle:bcpkix-jdk18on:1.87")
        add(androidToolVersions.name, "org.apache.commons:commons-lang3:3.20.0")
        add(androidToolVersions.name, "org.apache.httpcomponents:httpclient:4.5.14")
    }
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
