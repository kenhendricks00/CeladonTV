plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "dev.twitchcobalt"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.twitchcobalt"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
