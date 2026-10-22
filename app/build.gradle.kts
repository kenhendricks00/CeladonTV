import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.inputStream()?.use(::load)
}

android {
    namespace = "io.github.kenhendricks00.celadontv"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.kenhendricks00.celadontv"
        minSdk = 24
        targetSdk = 36
        versionCode = 8
        versionName = "0.2.6"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        localProperties.getProperty("celadontv.release.storeFile")?.let { storeFilePath ->
            create("release") {
                storeFile = file(storeFilePath)
                storePassword = localProperties.getProperty("celadontv.release.storePassword")
                keyAlias = localProperties.getProperty("celadontv.release.keyAlias")
                keyPassword = localProperties.getProperty("celadontv.release.keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.preference)
    implementation(libs.androidx.webkit)
    testImplementation(libs.json)
    testImplementation(libs.junit)
}

val testJs = tasks.register<Exec>("testJs") {
    description = "Runs the JavaScript tests for the injected scripts."
    group = "verification"
    inputs.dir("src/main/assets/scripts")
    inputs.dir("src/test/js")
    outputs.upToDateWhen { false }
    commandLine("node", "--test", "src/test/js/*.test.js")
}

tasks.named("check") {
    dependsOn(testJs)
}
