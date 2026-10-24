#![forbid(unsafe_code)]

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const LIMIT: usize = 64 * 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Deserialize, Serialize)]
pub struct Envelope {
    pub version: u8,
    pub salt: String,
    pub iv: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kdf: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<u32>,
}

fn decode(value: &str) -> Result<Vec<u8>> {
    if value.len() > LIMIT {
        return Err("内容超过限制");
    }
    B64.decode(value).map_err(|_| "Base64 格式无效")
}

pub fn derive(password: &str, salt: &str, version: u8) -> Result<Zeroizing<[u8; 32]>> {
    // Match JavaScript's UTF-16 length check for existing passwords, including emoji.
    if !(10..=256).contains(&password.encode_utf16().count()) {
        return Err("密码需要 10–256 个字符");
    }
    let salt = decode(salt)?;
    if !(16..=64).contains(&salt.len()) {
        return Err("盐长度无效");
    }
    let mut key = Zeroizing::new([0u8; 32]);
    match version {
        1 => scrypt::scrypt(
            password.as_bytes(),
            &salt,
            &scrypt::Params::new(15, 8, 1, 32).map_err(|_| "派生参数无效")?,
            &mut *key,
        )
        .map_err(|_| "派生失败")?,
        2 => pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, 310000, &mut *key),
        _ => return Err("不支持的备份版本"),
    }
    Ok(key)
}

pub fn seal(plaintext: &[u8], key: &[u8], salt: &str) -> Result<Envelope> {
    if plaintext.len() > LIMIT / 2 {
        return Err("内容超过限制");
    }
    if decode(salt)?.len() != 16 {
        return Err("盐长度无效");
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "密钥长度无效")?;
    let iv = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut encrypted = cipher.encrypt(&iv, plaintext).map_err(|_| "加密失败")?;
    let tag = encrypted.split_off(encrypted.len() - 16);
    Ok(Envelope {
        version: 1,
        salt: salt.into(),
        iv: B64.encode(iv),
        tag: Some(B64.encode(tag)),
        body: B64.encode(encrypted),
        kdf: None,
        iterations: None,
    })
}

pub fn unseal(
    envelope: &Envelope,
    password: &str,
) -> Result<(Zeroizing<Vec<u8>>, Zeroizing<[u8; 32]>)> {
    if envelope.version == 2
        && (envelope.kdf.as_deref() != Some("PBKDF2-SHA256") || envelope.iterations != Some(310000))
    {
        return Err("备份派生参数无效");
    }
    let iv = decode(&envelope.iv)?;
    if iv.len() != 12 {
        return Err("IV 长度无效");
    }
    let mut bytes = decode(&envelope.body)?;
    if envelope.version == 1 {
        let tag = decode(envelope.tag.as_deref().ok_or("缺少认证标签")?)?;
        if tag.len() != 16 {
            return Err("认证标签长度无效");
        }
        bytes.extend(tag);
    }
    if bytes.len() < 16 {
        return Err("密文长度无效");
    }
    let key = derive(password, &envelope.salt, envelope.version)?;
    let cipher = Aes256Gcm::new_from_slice(&*key).map_err(|_| "密钥长度无效")?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), bytes.as_ref())
        .map_err(|_| "密码错误或备份已损坏")?;
    Ok((Zeroizing::new(plaintext), key))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_tamper() {
        let salt = B64.encode([7u8; 16]);
        let key = derive("test-password-2026", &salt, 1).unwrap();
        let mut e = seal("{\"日程\":[]}".as_bytes(), &*key, &salt).unwrap();
        assert_eq!(
            &*unseal(&e, "test-password-2026").unwrap().0,
            "{\"日程\":[]}".as_bytes()
        );
        assert!(unseal(&e, "wrong-password").is_err());
        e.body.replace_range(..4, "AAAA");
        assert!(unseal(&e, "test-password-2026").is_err());
    }
    #[test]
    fn invalid_envelopes_fail_without_panicking() {
        let key = [1u8; 32];
        let salt = B64.encode([7u8; 16]);
        let mut e = seal(b"{}", &key, &salt).unwrap();
        e.iv = B64.encode([0u8; 11]);
        assert!(unseal(&e, "test-password").is_err());
        assert!(derive("short", &salt, 1).is_err());
        assert!(derive("test-password", &salt, 3).is_err());
    }
}
