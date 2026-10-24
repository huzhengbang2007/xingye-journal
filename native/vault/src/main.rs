#![forbid(unsafe_code)]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use xingye_vault::{derive, seal, unseal, Envelope, LIMIT};
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum Request {
    Derive {
        password: Zeroizing<String>,
        salt: String,
    },
    Seal {
        plaintext: Zeroizing<String>,
        key: Zeroizing<String>,
        salt: String,
    },
    Unseal {
        envelope: Envelope,
        password: Zeroizing<String>,
    },
}

fn run() -> Result<Value, &'static str> {
    let mut input = Zeroizing::new(String::new());
    io::stdin()
        .take((LIMIT + 1) as u64)
        .read_to_string(&mut input)
        .map_err(|_| "请求读取失败")?;
    if input.len() > LIMIT {
        return Err("请求超过限制");
    }
    let request: Request = serde_json::from_str(&input).map_err(|_| "请求格式无效")?;
    match request {
        Request::Derive { password, salt } => {
            Ok(json!({"key": B64.encode(&*derive(&password, &salt, 1)?)}))
        }
        Request::Seal {
            plaintext,
            key,
            salt,
        } => {
            let key = Zeroizing::new(B64.decode(key.as_bytes()).map_err(|_| "密钥格式无效")?);
            Ok(json!({"envelope": seal(plaintext.as_bytes(), &key, &salt)?}))
        }
        Request::Unseal { envelope, password } => {
            let (plaintext, key) = unseal(&envelope, &password)?;
            // Validate JSON without interpolating content into errors.
            serde_json::from_slice::<Value>(&plaintext).map_err(|_| "备份内容无效")?;
            Ok(
                json!({"plaintext": std::str::from_utf8(&plaintext).map_err(|_| "备份编码无效")?,
                "key": B64.encode(&*key), "salt": envelope.salt, "version": envelope.version}),
            )
        }
    }
}

fn main() -> std::process::ExitCode {
    let (result, code) = match run() {
        Ok(data) => (json!({"ok": true, "data": data}), 0),
        Err(error) => (json!({"ok": false, "error": error}), 1),
    };
    let encoded = Zeroizing::new(result.to_string());
    let _ = io::stdout().write_all(encoded.as_bytes());
    std::process::ExitCode::from(code)
}
