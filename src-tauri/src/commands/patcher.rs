
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use md5::{Digest as Md5Digest, Md5};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

fn robust_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    clear_readonly(path);
    match retry_io(|| fs::write(path, data)) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() != std::io::ErrorKind::PermissionDenied => return Err(e),
        Err(_) => {}
    }
    clear_readonly(path);
    let _ = retry_io(|| fs::remove_file(path));
    retry_io(|| fs::write(path, data))
}

fn retry_io<T, F>(mut op: F) -> std::io::Result<T>
where
    F: FnMut() -> std::io::Result<T>,
{
    const DELAYS_MS: [u64; 10] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 1000];
    let mut last_err: Option<std::io::Error> = None;
    for delay in DELAYS_MS.iter().copied() {
        match op() {
            Ok(v) => return Ok(v),
            Err(e) => {
                let kind = e.kind();
                let retriable = matches!(
                    kind,
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Other
                );
                last_err = Some(e);
                if !retriable {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
        }
    }
    match op() {
        Ok(v) => Ok(v),
        Err(e) => Err(last_err.unwrap_or(e)),
    }
}

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

const AES_KEY: [u8; 32] = [
    0x31, 0x4C, 0x20, 0x86, 0x15, 0x05, 0x74, 0xE1,
    0x5C, 0xF1, 0x1D, 0x1B, 0xC1, 0x71, 0x25, 0x1A,
    0x47, 0x08, 0x6C, 0x00, 0x26, 0x93, 0x55, 0xCD,
    0x51, 0xC9, 0x3A, 0x42, 0x3C, 0x14, 0x02, 0x94,
];

const HIJACK_CANDIDATES: &[&str] = &["xinput1_4.dll", "dwmapi.dll"];

#[derive(Clone, Debug)]
struct PatchTemplate {
    offset: i32,
    original: &'static [u8],
    replacement: &'static [u8],
}

#[derive(Clone, Debug)]
struct ResolvedPatch {
    offset: usize,
    original: Vec<u8>,
    replacement: Vec<u8>,
}

const CORE_PATCHES: &[PatchTemplate] = &[
    PatchTemplate {
        offset: 0x272F,
        original: &[0xE8, 0x7C, 0xF5, 0xFF, 0xFF],
        replacement: &[0xB8, 0x01, 0x00, 0x00, 0x00],
    },
    PatchTemplate {
        offset: 0x28B5,
        original: &[0x74],
        replacement: &[0xEB],
    },
];

const PAYLOAD_PATCHES: &[PatchTemplate] = &[
    PatchTemplate {
        offset: 0x0D4CF,
        original: &[0x0F, 0x84, 0x3B, 0x01, 0x00, 0x00],
        replacement: &[0x90, 0xE9, 0x3B, 0x01, 0x00, 0x00],
    },
    PatchTemplate {
        offset: 0x0D7D9,
        original: &[0x8B, 0x0D, 0x7D, 0xCA, 0x1B, 0x00],
        replacement: &[0x31, 0xC9, 0x90, 0x90, 0x90, 0x90],
    },
    PatchTemplate {
        offset: 0x1D555A,
        original: &[0x89, 0x3D, 0x28, 0xD5, 0xFE, 0xFF],
        replacement: &[0x90, 0x90, 0x90, 0x90, 0x90, 0x90],
    },
    PatchTemplate {
        offset: 0x1E0A15,
        original: &[0xC6, 0x05, 0xC6, 0x20, 0xFE, 0xFF, 0x00],
        replacement: &[0xC6, 0x05, 0xC6, 0x20, 0xFE, 0xFF, 0x01],
    },
    PatchTemplate {
        offset: 0x3BAE0,
        original: &[0x75],
        replacement: &[0xEB],
    },
];

#[cfg(target_arch = "x86_64")]
fn cpuid(leaf: u32) -> (u32, u32, u32, u32) {
    let r = std::arch::x86_64::__cpuid(leaf);
    (r.eax, r.ebx, r.ecx, r.edx)
}

#[allow(dead_code)]
fn _digest_trait_used(h: Sha256) -> [u8; 32] {
    let out = <Sha256 as Digest>::finalize(h);
    out.into()
}

#[cfg(not(target_arch = "x86_64"))]
fn cpuid(_leaf: u32) -> (u32, u32, u32, u32) {
    (0, 0, 0, 0)
}

fn compute_fingerprint() -> String {
    let (_, ebx0, ecx0, edx0) = cpuid(0);
    let mut vendor = [0u8; 12];
    vendor[0..4].copy_from_slice(&ebx0.to_le_bytes());
    vendor[4..8].copy_from_slice(&edx0.to_le_bytes());
    vendor[8..12].copy_from_slice(&ecx0.to_le_bytes());
    let vendor_str = String::from_utf8_lossy(&vendor).into_owned();

    let (eax1, _, _, _) = cpuid(1);
    let family = ((eax1 >> 8) & 0xF) as i32;
    let model = ((eax1 >> 4) & 0xF) as i32;
    let nproc = (num_cpus() & 0xFF) as i32;

    let tag = format!("V{}_F{:X}_M{:X}_C{:X}", vendor_str, family, model, nproc);
    let tag_bytes = tag.as_bytes();

    let key = b"version";
    let xored: Vec<u8> = tag_bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % 7])
        .collect();

    let mut md5 = Md5::new();
    md5.update(&xored);
    let md5_hex = format!("{:x}", md5.finalize());
    let md5_hex_bytes = md5_hex.as_bytes();

    let mut crc: u64 = 0xFFFFFFFFFFFFFFFF;
    for &b in md5_hex_bytes {
        crc ^= b as u64;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0x85E1C3D753D46D27;
            } else {
                crc >>= 1;
            }
        }
    }
    let crc = crc ^ 0xFFFFFFFFFFFFFFFF;
    format!("{:016X}", crc)
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

fn find_cache_path(steam_path: &Path) -> Option<PathBuf> {
    let cache_dir = steam_path.join("appcache").join("httpcache").join("3b");
    if !cache_dir.exists() {
        return None;
    }

    let fp = compute_fingerprint();
    let direct = cache_dir.join(&fp);
    if direct.exists() {
        return Some(direct);
    }

    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.len() == 16 {
                if let Ok(meta) = entry.metadata() {
                    let len = meta.len();
                    if (500_000..5_000_000).contains(&len) {
                        return Some(entry.path());
                    }
                }
            }
        }
    }
    None
}

fn aes_cbc_decrypt(ct: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    let dec = Aes256CbcDec::new_from_slices(&AES_KEY, iv)
        .map_err(|e| format!("aes key/iv: {}", e))?;
    let mut buf = ct.to_vec();
    let pt = dec
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("aes decrypt: {}", e))?;
    Ok(pt.to_vec())
}

fn aes_cbc_encrypt(pt: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    let enc = Aes256CbcEnc::new_from_slices(&AES_KEY, iv)
        .map_err(|e| format!("aes key/iv: {}", e))?;
    let mut buf = vec![0u8; pt.len() + 16];
    buf[..pt.len()].copy_from_slice(pt);
    let ct = enc
        .encrypt_padded_mut::<Pkcs7>(&mut buf, pt.len())
        .map_err(|e| format!("aes encrypt: {}", e))?;
    Ok(ct.to_vec())
}

fn read_and_decrypt_payload(cache_path: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let raw = fs::read(cache_path).map_err(|e| format!("read cache: {}", e))?;
    if raw.len() < 32 {
        return Err("cache file too small".to_string());
    }

    let iv = raw[..16].to_vec();
    let ct = &raw[16..];
    let dec = aes_cbc_decrypt(ct, &iv)?;
    if dec.len() < 4 {
        return Err("decrypted payload too small".to_string());
    }

    let mut zin = ZlibDecoder::new(&dec[4..]);
    let mut out = Vec::new();
    zin.read_to_end(&mut out)
        .map_err(|e| format!("zlib inflate: {}", e))?;
    Ok((out, iv))
}

fn reencrypt_and_write(cache_path: &Path, payload: &[u8], iv: &[u8]) -> Result<(), String> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::best());
    enc.write_all(payload)
        .map_err(|e| format!("zlib deflate: {}", e))?;
    let compressed = enc.finish().map_err(|e| format!("zlib finish: {}", e))?;

    let mut blob = Vec::with_capacity(4 + compressed.len());
    blob.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    blob.extend_from_slice(&compressed);

    let new_ct = aes_cbc_encrypt(&blob, iv)?;
    let mut output = Vec::with_capacity(16 + new_ct.len());
    output.extend_from_slice(iv);
    output.extend_from_slice(&new_ct);
    robust_write(cache_path, &output).map_err(|e| format!("write cache: {}", e))?;
    Ok(())
}

#[derive(Clone, Debug)]
struct PeSection {
    name: String,
    raw_offset: usize,
    raw_size: usize,
}

fn parse_pe_sections(pe: &[u8]) -> Vec<PeSection> {
    if pe.len() < 64 {
        return Vec::new();
    }
    let pe_off = u32::from_le_bytes(pe[0x3C..0x40].try_into().unwrap_or([0; 4])) as usize;
    if pe_off == 0 || pe_off + 24 > pe.len() {
        return Vec::new();
    }
    if pe[pe_off] != b'P' || pe[pe_off + 1] != b'E' {
        return Vec::new();
    }
    let num_sections = u16::from_le_bytes([pe[pe_off + 6], pe[pe_off + 7]]) as usize;
    if num_sections > 96 {
        return Vec::new();
    }
    let opt_size = u16::from_le_bytes([pe[pe_off + 20], pe[pe_off + 21]]) as usize;
    let first_section = pe_off + 24 + opt_size;
    if first_section + num_sections * 40 > pe.len() {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let off = first_section + i * 40;
        let mut name_end = 0usize;
        for j in 0..8 {
            if pe[off + j] == 0 {
                break;
            }
            name_end = j + 1;
        }
        let name = String::from_utf8_lossy(&pe[off..off + name_end]).into_owned();
        let raw_size =
            u32::from_le_bytes(pe[off + 16..off + 20].try_into().unwrap_or([0; 4])) as usize;
        let raw_off =
            u32::from_le_bytes(pe[off + 20..off + 24].try_into().unwrap_or([0; 4])) as usize;
        out.push(PeSection {
            name,
            raw_offset: raw_off,
            raw_size,
        });
    }
    out
}

fn find_section<'a>(sections: &'a [PeSection], name: &str) -> Option<&'a PeSection> {
    sections.iter().find(|s| s.name == name)
}

fn resolve_payload_sections(payload: &[u8]) -> Result<(usize, usize, usize, usize), String> {
    let sections = parse_pe_sections(payload);
    let text = find_section(&sections, ".text").ok_or("missing .text section")?;

    let known: &[&str] = &[
        ".text", ".rdata", ".data", ".pdata", ".fptable", ".rsrc", ".reloc",
    ];
    let obf = sections
        .iter()
        .find(|s| !known.contains(&s.name.as_str()))
        .ok_or("missing obfuscated section")?;

    let t_start = text.raw_offset;
    let t_end = (text.raw_offset + text.raw_size).min(payload.len());
    let g_start = obf.raw_offset;
    let g_end = (obf.raw_offset + obf.raw_size).min(payload.len());
    Ok((t_start, t_end, g_start, g_end))
}

fn scan_for_bytes(data: &[u8], start: usize, end: usize, needle: &[u8]) -> Option<usize> {
    let end = end.min(data.len());
    if needle.is_empty() || end < start + needle.len() {
        return None;
    }
    let limit = end - needle.len();
    for i in start..=limit {
        if data[i..i + needle.len()] == *needle {
            return Some(i);
        }
    }
    None
}

fn find_core_patch1(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    let mut pos = start;
    while pos + 9 <= end {
        let mut hit = None;
        for i in pos..=end - 9 {
            if data[i] == 0xE8
                && data[i + 5] == 0x85
                && data[i + 6] == 0xC0
                && data[i + 7] == 0x0F
                && data[i + 8] == 0x84
            {
                hit = Some(i);
                break;
            }
        }
        let idx = hit?;
        let rel = i32::from_le_bytes(data[idx + 1..idx + 5].try_into().ok()?);
        if rel < 0 {
            return Some(idx);
        }
        pos = idx + 1;
    }
    None
}

fn find_core_patch2(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    if end >= 6 + start {
        for i in start..end - 6 {
            if data[i] == 0x85
                && data[i + 1] == 0xC0
                && (data[i + 2] == 0x74 || data[i + 2] == 0xEB)
                && data[i + 4] == 0x33
                && data[i + 5] == 0xFF
            {
                return Some(i + 2);
            }
        }
    }
    if end >= 5 + start {
        for i in start..end - 5 {
            if (data[i] == 0x74 || data[i] == 0xEB)
                && data[i + 2] == 0x33
                && data[i + 3] == 0xFF
                && data[i + 4] == 0xE9
            {
                return Some(i);
            }
        }
    }
    None
}

fn find_payload_patch1(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    if end < 17 + start {
        return None;
    }
    for i in start..end - 17 {
        if data[i] == 0x85
            && data[i + 1] == 0xC0
            && data[i + 2] == 0x0F
            && data[i + 3] == 0x85
            && data[i + 6] == 0x00
            && data[i + 7] == 0x00
            && data[i + 8] == 0x45
            && data[i + 9] == 0x85
            && data[i + 10] == 0xFF
            && data[i + 15] == 0x00
            && data[i + 16] == 0x00
        {
            if (data[i + 11] == 0x0F && data[i + 12] == 0x84)
                || (data[i + 11] == 0x90 && data[i + 12] == 0xE9)
            {
                return Some(i + 11);
            }
        }
    }
    None
}

fn find_payload_patch2(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    if end < 10 + start {
        return None;
    }
    for i in start..end - 10 {
        if data[i + 6] == 0x48
            && data[i + 7] == 0x8D
            && data[i + 8] == 0x14
            && data[i + 9] == 0x3E
            && ((data[i] == 0x8B && data[i + 1] == 0x0D)
                || (data[i] == 0x31 && data[i + 1] == 0xC9))
        {
            return Some(i);
        }
    }
    None
}

fn find_payload_patch3(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    let spacewar = [0xC7, 0x40, 0x09, 0xE0, 0x01, 0x00, 0x00];
    let anchor = scan_for_bytes(data, start, end, &spacewar)?;
    let search_start = anchor + spacewar.len();
    let search_end = (search_start + 30).min(end);
    if search_end < 6 + search_start {
        return None;
    }
    for i in search_start..search_end - 5 {
        if data[i] == 0x89 && data[i + 1] == 0x3D {
            return Some(i);
        }
        if data[i..i + 6] == [0x90; 6] {
            return Some(i);
        }
    }
    None
}

fn find_payload_patch4(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    if end < 24 + start {
        return None;
    }
    for i in start..end - 24 {
        if data[i] != 0xC6 || data[i + 1] != 0x05 {
            continue;
        }
        if data[i + 4] != 0xFE || data[i + 5] != 0xFF {
            continue;
        }
        if data[i + 6] != 0x01 {
            continue;
        }
        let b = i + 7;
        if b + 17 > end {
            continue;
        }
        if data[b] != 0xE9 || data[b + 1] != 0 || data[b + 2] != 0 || data[b + 3] != 0
            || data[b + 4] != 0
        {
            continue;
        }
        if data[b + 5] != 0xE9 {
            continue;
        }
        if data[b + 8] != 0 || data[b + 9] != 0 {
            continue;
        }
        let fail_off = b + 10;
        if data[fail_off] != 0xC6 || data[fail_off + 1] != 0x05 {
            continue;
        }
        if data[fail_off + 4] != 0xFE || data[fail_off + 5] != 0xFF {
            continue;
        }
        if data[fail_off + 6] != 0x00 && data[fail_off + 6] != 0x01 {
            continue;
        }
        return Some(fail_off);
    }
    None
}

fn find_payload_patch5(data: &[u8], start: usize, end: usize) -> Option<usize> {
    let end = end.min(data.len());
    if end < 12 + start {
        return None;
    }
    for i in start..end - 12 {
        if data[i] != 0xE8 {
            continue;
        }
        if data[i + 5] != 0x48 || data[i + 6] != 0x85 || data[i + 7] != 0xF6 {
            continue;
        }
        if data[i + 8] != 0x75 && data[i + 8] != 0xEB {
            continue;
        }
        let skip_dist = data[i + 9] as usize;
        let after_skip = i + 10 + skip_dist;
        if after_skip > end {
            continue;
        }
        let mut has_loop = false;
        let mut j = i + 10;
        while j < after_skip && j + 5 < end {
            if data[j] == 0xE9 {
                let rel = i32::from_le_bytes(data[j + 1..j + 5].try_into().unwrap_or([0; 4]));
                if rel < 0 {
                    has_loop = true;
                    break;
                }
            }
            j += 1;
        }
        if !has_loop {
            continue;
        }
        return Some(i + 8);
    }
    None
}

fn bytes_match(data: &[u8], offset: usize, pattern: &[u8]) -> bool {
    if offset + pattern.len() > data.len() {
        return false;
    }
    &data[offset..offset + pattern.len()] == pattern
}

fn snapshot_patch(
    data: &[u8],
    offset: usize,
    template: &PatchTemplate,
    wildcard_start: usize,
    wildcard_len: usize,
) -> ResolvedPatch {
    let mut original = template.original.to_vec();
    let mut replacement = template.replacement.to_vec();
    if wildcard_len > 0
        && wildcard_start + wildcard_len <= original.len()
        && offset + wildcard_start + wildcard_len <= data.len()
    {
        let slice = &data[offset + wildcard_start..offset + wildcard_start + wildcard_len];
        original[wildcard_start..wildcard_start + wildcard_len].copy_from_slice(slice);
        replacement[wildcard_start..wildcard_start + wildcard_len].copy_from_slice(slice);
    }
    ResolvedPatch {
        offset,
        original,
        replacement,
    }
}

fn check_patches(data: &[u8], patches: &[ResolvedPatch]) -> (usize, usize, Vec<String>) {
    let mut applied = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();
    for p in patches {
        if bytes_match(data, p.offset, &p.replacement) {
            skipped += 1;
        } else if bytes_match(data, p.offset, &p.original) {
            applied += 1;
        } else {
            errors.push(format!("mismatch at 0x{:X}", p.offset));
        }
    }
    (applied, skipped, errors)
}

fn apply_patches(
    data: &[u8],
    patches: &[ResolvedPatch],
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut buf = data.to_vec();
    let mut applied = 0;
    let mut skipped = 0;
    for p in patches {
        if bytes_match(&buf, p.offset, &p.replacement) {
            skipped += 1;
        } else if bytes_match(&buf, p.offset, &p.original) {
            buf[p.offset..p.offset + p.replacement.len()].copy_from_slice(&p.replacement);
            applied += 1;
        } else {
            return Err(format!(
                "byte mismatch at 0x{:X} — wrong SteamTools version?",
                p.offset
            ));
        }
    }
    Ok((buf, applied, skipped))
}

fn try_hardcoded_or_scan<F>(
    data: &[u8],
    hardcoded: usize,
    original: &[u8],
    replacement: &[u8],
    scan: F,
) -> Option<usize>
where
    F: FnOnce() -> Option<usize>,
{
    if hardcoded + original.len() <= data.len()
        && (bytes_match(data, hardcoded, original) || bytes_match(data, hardcoded, replacement))
    {
        return Some(hardcoded);
    }
    scan()
}

fn find_core_dll(steam_path: &Path) -> Option<String> {
    for name in HIJACK_CANDIDATES {
        let p = steam_path.join(name);
        if !p.exists() {
            continue;
        }
        if let Ok(bytes) = fs::read(&p) {
            if scan_for_bytes(&bytes, 0, bytes.len(), &AES_KEY).is_some() {
                return Some((*name).to_string());
            }
        }
    }
    None
}

fn resolve_core_patches(dll: &[u8]) -> Result<Vec<ResolvedPatch>, String> {
    let sections = parse_pe_sections(dll);
    let rdata = find_section(&sections, ".rdata").ok_or("Core.dll: no .rdata section")?;
    let rdata_end = (rdata.raw_offset + rdata.raw_size).min(dll.len());
    let key_off = scan_for_bytes(dll, rdata.raw_offset, rdata_end, &AES_KEY)
        .or_else(|| scan_for_bytes(dll, 0, dll.len(), &AES_KEY));
    if key_off.is_none() {
        return Err("Core.dll: AES key not found — unrecognized SteamTools version".to_string());
    }

    let text = find_section(&sections, ".text").ok_or("Core.dll: no .text section")?;
    let t_start = text.raw_offset;
    let t_end = (text.raw_offset + text.raw_size).min(dll.len());

    let p1 = try_hardcoded_or_scan(
        dll,
        CORE_PATCHES[0].offset as usize,
        CORE_PATCHES[0].original,
        CORE_PATCHES[0].replacement,
        || find_core_patch1(dll, t_start, t_end),
    )
    .ok_or("Core.dll: could not locate download call patch")?;

    let p2 = try_hardcoded_or_scan(
        dll,
        CORE_PATCHES[1].offset as usize,
        CORE_PATCHES[1].original,
        CORE_PATCHES[1].replacement,
        || find_core_patch2(dll, p1, (p1 + 0x300).min(t_end)),
    )
    .ok_or("Core.dll: could not locate hash-check jump patch")?;

    Ok(vec![
        snapshot_patch(dll, p1, &CORE_PATCHES[0], 0, 0),
        snapshot_patch(dll, p2, &CORE_PATCHES[1], 0, 0),
    ])
}

fn resolve_capcom_patches(payload: &[u8]) -> Result<Vec<ResolvedPatch>, String> {
    let (t_start, t_end, g_start, g_end) = resolve_payload_sections(payload)?;

    let p1 = try_hardcoded_or_scan(
        payload,
        PAYLOAD_PATCHES[0].offset as usize,
        PAYLOAD_PATCHES[0].original,
        PAYLOAD_PATCHES[0].replacement,
        || find_payload_patch1(payload, t_start, t_end),
    )
    .ok_or("Payload: could not locate cloud rewrite skip")?;

    let p2 = try_hardcoded_or_scan(
        payload,
        PAYLOAD_PATCHES[1].offset as usize,
        PAYLOAD_PATCHES[1].original,
        PAYLOAD_PATCHES[1].replacement,
        || find_payload_patch2(payload, p1, (p1 + 0x500).min(t_end)),
    )
    .ok_or("Payload: could not locate proxy appid load")?;

    let p3 = try_hardcoded_or_scan(
        payload,
        PAYLOAD_PATCHES[2].offset as usize,
        PAYLOAD_PATCHES[2].original,
        PAYLOAD_PATCHES[2].replacement,
        || find_payload_patch3(payload, g_start, g_end),
    )
    .ok_or("Payload: could not locate IPC appid preserve site")?;

    Ok(vec![
        snapshot_patch(payload, p1, &PAYLOAD_PATCHES[0], 2, 4),
        snapshot_patch(payload, p2, &PAYLOAD_PATCHES[1], 0, 0),
        snapshot_patch(payload, p3, &PAYLOAD_PATCHES[2], 0, 0),
    ])
}

fn resolve_offline_patches(payload: &[u8]) -> Result<Vec<ResolvedPatch>, String> {
    let (t_start, t_end, g_start, g_end) = resolve_payload_sections(payload)?;

    let p4 = try_hardcoded_or_scan(
        payload,
        PAYLOAD_PATCHES[3].offset as usize,
        PAYLOAD_PATCHES[3].original,
        PAYLOAD_PATCHES[3].replacement,
        || find_payload_patch4(payload, g_start, g_end),
    )
    .ok_or("Payload: could not locate activation flag site")?;

    let p5 = try_hardcoded_or_scan(
        payload,
        PAYLOAD_PATCHES[4].offset as usize,
        PAYLOAD_PATCHES[4].original,
        PAYLOAD_PATCHES[4].replacement,
        || find_payload_patch5(payload, t_start, t_end),
    )
    .ok_or("Payload: could not locate GetCookie retry patch")?;

    Ok(vec![
        snapshot_patch(payload, p4, &PAYLOAD_PATCHES[3], 2, 4),
        snapshot_patch(payload, p5, &PAYLOAD_PATCHES[4], 0, 0),
    ])
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum PatchState {
    NotInstalled,
    Unpatched,
    Patched,
    PartiallyPatched,
    OutOfDate,
    PayloadCorrupt,
    UnknownVersion,
}

fn classify(applied: usize, skipped: usize, total: usize, errors: &[String]) -> PatchState {
    if !errors.is_empty() {
        return PatchState::OutOfDate;
    }
    if applied == 0 && skipped == total {
        return PatchState::Patched;
    }
    if skipped == 0 && applied == total {
        return PatchState::Unpatched;
    }
    PatchState::PartiallyPatched
}

fn core_dll_state(steam_path: &Path) -> PatchState {
    let dll_name = match find_core_dll(steam_path) {
        Some(n) => n,
        None => return PatchState::NotInstalled,
    };
    let dll_path = steam_path.join(&dll_name);
    let bytes = match fs::read(&dll_path) {
        Ok(b) => b,
        Err(_) => return PatchState::PayloadCorrupt,
    };
    match resolve_core_patches(&bytes) {
        Ok(resolved) => {
            let (applied, skipped, errors) = check_patches(&bytes, &resolved);
            classify(applied, skipped, resolved.len(), &errors)
        }
        Err(_) => PatchState::UnknownVersion,
    }
}

fn payload_state<F>(steam_path: &Path, resolver: F) -> PatchState
where
    F: FnOnce(&[u8]) -> Result<Vec<ResolvedPatch>, String>,
{
    let cache_path = match find_cache_path(steam_path) {
        Some(p) => p,
        None => return PatchState::NotInstalled,
    };
    let (payload, _iv) = match read_and_decrypt_payload(&cache_path) {
        Ok(p) => p,
        Err(_) => return PatchState::PayloadCorrupt,
    };
    match resolver(&payload) {
        Ok(resolved) => {
            let (applied, skipped, errors) = check_patches(&payload, &resolved);
            classify(applied, skipped, resolved.len(), &errors)
        }
        Err(_) => PatchState::UnknownVersion,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct PatcherDiagnostics {
    pub steam_path: String,
    pub core_dll_name: Option<String>,
    pub core_dll_state: PatchState,
    pub capcom_state: PatchState,
    pub offline_state: PatchState,
    pub needs_dll_repair: bool,
    pub fingerprint: String,
    pub cache_found: bool,
}

#[tauri::command]
pub async fn patcher_diagnose(steam_path: String) -> Result<PatcherDiagnostics, String> {
    let sp = PathBuf::from(&steam_path);
    let core_dll_name = find_core_dll(&sp);
    let cache_found = find_cache_path(&sp).is_some();

    let core_state = core_dll_state(&sp);
    let capcom = payload_state(&sp, resolve_capcom_patches);
    let offline = payload_state(&sp, resolve_offline_patches);

    let needs_repair = HIJACK_CANDIDATES
        .iter()
        .all(|n| !sp.join(n).exists());

    Ok(PatcherDiagnostics {
        steam_path,
        core_dll_name,
        core_dll_state: core_state,
        capcom_state: capcom,
        offline_state: offline,
        needs_dll_repair: needs_repair,
        fingerprint: compute_fingerprint(),
        cache_found,
    })
}

#[derive(Serialize, Clone, Debug)]
pub struct PatchActionResult {
    pub succeeded: bool,
    pub dll_patched: bool,
    pub cache_patched: bool,
    pub message: String,
}

fn run_patch_op(
    steam_path: &Path,
    patch_dll: bool,
    resolver: impl FnOnce(&[u8]) -> Result<Vec<ResolvedPatch>, String>,
) -> Result<PatchActionResult, String> {
    let mut res = PatchActionResult {
        succeeded: false,
        dll_patched: false,
        cache_patched: false,
        message: String::new(),
    };

    let mut dll_output: Option<(PathBuf, Vec<u8>)> = None;
    if patch_dll {
        let dll_name = find_core_dll(steam_path)
            .ok_or("SteamTools Core DLL not found — is SteamTools installed?")?;
        let dll_path = steam_path.join(&dll_name);
        let dll_data = fs::read(&dll_path)
            .map_err(|e| format!("{} in use — close Steam first ({})", dll_name, e))?;
        let resolved = resolve_core_patches(&dll_data)?;
        let (patched, _applied, _skipped) = apply_patches(&dll_data, &resolved)?;
        dll_output = Some((dll_path, patched));
    }

    let cache_path = find_cache_path(steam_path).ok_or(
        "Payload cache not found — launch Steam with SteamTools at least once to download it",
    )?;
    let (payload, iv) = read_and_decrypt_payload(&cache_path)?;
    let resolved = resolver(&payload)?;
    let (patched_payload, applied, _skipped) = apply_patches(&payload, &resolved)?;

    if let Some((dll_path, patched_dll)) = dll_output {
        robust_write(&dll_path, &patched_dll)
            .map_err(|e| format!("DLL write: {}", e))?;
        res.dll_patched = true;
    }

    if applied > 0 {
        reencrypt_and_write(&cache_path, &patched_payload, &iv)?;
    }
    res.cache_patched = true;
    res.succeeded = true;
    res.message = "Done.".to_string();

    let _ = super::config::set_patches_applied(true);
    Ok(res)
}

#[tauri::command]
pub async fn patcher_apply_capcom(steam_path: String) -> Result<PatchActionResult, String> {
    let sp = PathBuf::from(&steam_path);
    run_patch_op(&sp, false, resolve_capcom_patches)
}

#[tauri::command]
pub async fn patcher_apply_offline(steam_path: String) -> Result<PatchActionResult, String> {
    let sp = PathBuf::from(&steam_path);
    run_patch_op(&sp, true, resolve_offline_patches)
}

#[tauri::command]
pub async fn patcher_restore(steam_path: String) -> Result<PatchActionResult, String> {
    let sp = PathBuf::from(&steam_path);
    let mut actions: Vec<&str> = Vec::new();

    super::config::set_patches_applied(false)
        .map_err(|e| format!("failed to clear patches_applied: {}", e))?;

    if let Some(cache_path) = find_cache_path(&sp) {
        if cache_path.exists() {
            let _ = retry_io(|| fs::remove_file(&cache_path));
            actions.push("payload cache cleared");
        }
    }

    let result = super::veil::ensure_veil_dll(steam_path)?;
    let dll_patched = matches!(result.as_str(), "repaired" | "installed");
    if dll_patched {
        actions.push("DLLs restored");
    }

    Ok(PatchActionResult {
        succeeded: true,
        dll_patched,
        cache_patched: true,
        message: if actions.is_empty() {
            "Nothing to restore — already pristine.".to_string()
        } else {
            format!("Restored: {}.", actions.join(", "))
        },
    })
}

#[tauri::command]
pub async fn patcher_delete_cache(steam_path: String) -> Result<bool, String> {
    let sp = PathBuf::from(&steam_path);
    match find_cache_path(&sp) {
        Some(p) => {
            fs::remove_file(&p).map_err(|e| format!("delete cache: {}", e))?;
            Ok(true)
        }
        None => Ok(false),
    }
}
