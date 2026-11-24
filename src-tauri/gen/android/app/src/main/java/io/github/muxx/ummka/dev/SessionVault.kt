package io.github.muxx.ummka.dev

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.annotation.Keep
import java.io.File
import java.security.KeyStore
import java.security.KeyStoreException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only the native host calls this adapter, on a worker thread. */
@Keep
internal class SessionVault(private val context: Context) {
    private val alias = "${context.packageName}.mattermost.sessions.v1"

    fun databasePath(): String = File(context.noBackupFilesDir, "account-sessions.sqlite").absolutePath

    private fun key(mayCreate: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null)
        if (existing != null) return existing as SecretKey
        if (!mayCreate) throw KeyStoreException("Session key unavailable")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return generator.generateKey()
    }

    fun seal(aad: ByteArray, token: ByteArray, mayCreate: Boolean): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(mayCreate))
        check(cipher.iv.size == IV_SIZE)
        cipher.updateAAD(aad)
        return cipher.iv + cipher.doFinal(token)
    }

    // Null means the stored value failed authentication. Keystore failures still throw.
    fun open(aad: ByteArray, value: ByteArray): ByteArray? {
        if (value.size < IV_SIZE + TAG_BITS / 8) return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(TAG_BITS, value, 0, IV_SIZE))
        cipher.updateAAD(aad)
        return try {
            cipher.doFinal(value, IV_SIZE, value.size - IV_SIZE)
        } catch (_: AEADBadTagException) {
            null
        }
    }

    private companion object {
        const val IV_SIZE = 12
        const val TAG_BITS = 128
    }
}
