use aes::cipher::{block_padding::Pkcs7, BlockModeDecrypt, BlockModeEncrypt, KeyIvInit};
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use md5::{Digest as Md5Digest, Md5};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const XINPUT_URL: &str = "https://app.projectveil.cc/dll/xinput1_4.dll";
const DWMAPI_URL: &str = "https://app.projectveil.cc/dll/dwmapi.dll";
const HASHES_URL: &str = "https://app.projectveil.cc/dll/hashes";

fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

fn lock_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if !perms.readonly() {
            perms.set_readonly(true);
            let _ = fs::set_permissions(path, perms);
        }
    }
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

type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

const AES_KEY: [u8; 32] = [
    0x31, 0x4C, 0x20, 0x86, 0x15, 0x05, 0x74, 0xE1, 0x5C, 0xF1, 0x1D, 0x1B, 0xC1, 0x71, 0x25, 0x1A,
    0x47, 0x08, 0x6C, 0x00, 0x26, 0x93, 0x55, 0xCD, 0x51, 0xC9, 0x3A, 0x42, 0x3C, 0x14, 0x02, 0x94,
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

#[cfg(not(target_arch = "x86_64"))]
fn cpuid(_leaf: u32) -> (u32, u32, u32, u32) {
    (0, 0, 0, 0)
}

fn num_cpus() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
}

pub fn compute_fingerprint() -> String {
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
    let xored: Vec<u8> = tag_bytes.iter().enumerate().map(|(i, b)| b ^ key[i % 7]).collect();

    let mut md5 = Md5::new();
    Md5Digest::update(&mut md5, &xored);
    let md5_hex: String = md5.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    let md5_hex_bytes = md5_hex.as_bytes();

    let mut crc: u64 = 0xFFFF_FFFF_FFFF_FFFF;
    for &b in md5_hex_bytes {
        crc ^= b as u64;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0x85E1_C3D7_53D4_6D27;
            } else {
                crc >>= 1;
            }
        }
    }
    let crc = crc ^ 0xFFFF_FFFF_FFFF_FFFF;
    format!("{:016X}", crc)
}

pub fn find_cache_path(steam_path: &Path) -> Option<PathBuf> {
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
    let dec = Aes256CbcDec::new_from_slices(&AES_KEY, iv).map_err(|e| format!("aes key/iv: {}", e))?;
    let mut buf = ct.to_vec();
    let pt = dec
        .decrypt_padded::<Pkcs7>(&mut buf)
        .map_err(|e| format!("aes decrypt: {}", e))?;
    Ok(pt.to_vec())
}

fn aes_cbc_encrypt(pt: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    let enc = Aes256CbcEnc::new_from_slices(&AES_KEY, iv).map_err(|e| format!("aes key/iv: {}", e))?;
    let mut buf = vec![0u8; pt.len() + 16];
    buf[..pt.len()].copy_from_slice(pt);
    let ct = enc
        .encrypt_padded::<Pkcs7>(&mut buf, pt.len())
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
    zin.read_to_end(&mut out).map_err(|e| format!("zlib inflate: {}", e))?;
    Ok((out, iv))
}

fn reencrypt_and_write(cache_path: &Path, payload: &[u8], iv: &[u8]) -> Result<(), String> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::best());
    enc.write_all(payload).map_err(|e| format!("zlib deflate: {}", e))?;
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
    virtual_address: usize,
    virtual_size: usize,
    raw_offset: usize,
    raw_size: usize,
    characteristics: u32,
}

impl PeSection {
    // IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_CNT_CODE
    fn is_executable(&self) -> bool {
        self.characteristics & 0x2000_0000 != 0 || self.characteristics & 0x0000_0020 != 0
    }
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
        let virtual_size = u32::from_le_bytes(pe[off + 8..off + 12].try_into().unwrap_or([0; 4])) as usize;
        let virtual_address = u32::from_le_bytes(pe[off + 12..off + 16].try_into().unwrap_or([0; 4])) as usize;
        let raw_size = u32::from_le_bytes(pe[off + 16..off + 20].try_into().unwrap_or([0; 4])) as usize;
        let raw_off = u32::from_le_bytes(pe[off + 20..off + 24].try_into().unwrap_or([0; 4])) as usize;
        let characteristics = u32::from_le_bytes(pe[off + 36..off + 40].try_into().unwrap_or([0; 4]));
        out.push(PeSection {
            name,
            virtual_address,
            virtual_size,
            raw_offset: raw_off,
            raw_size,
            characteristics,
        });
    }
    out
}

fn find_section<'a>(sections: &'a [PeSection], name: &str) -> Option<&'a PeSection> {
    sections.iter().find(|s| s.name == name)
}

fn rva_to_file_offset(sections: &[PeSection], rva: usize) -> Option<usize> {
    for s in sections {
        let vsize = if s.virtual_size != 0 { s.virtual_size } else { s.raw_size };
        if rva >= s.virtual_address && rva < s.virtual_address + vsize {
            let delta = rva - s.virtual_address;
            if delta < s.raw_size {
                return Some(s.raw_offset + delta);
            }
            return None;
        }
    }
    None
}

fn file_offset_to_rva(sections: &[PeSection], file_off: usize) -> Option<usize> {
    for s in sections {
        if file_off >= s.raw_offset && file_off < s.raw_offset + s.raw_size {
            return Some(s.virtual_address + (file_off - s.raw_offset));
        }
    }
    None
}

fn resolve_payload_sections(payload: &[u8]) -> Result<(usize, usize, usize, usize), String> {
    let sections = parse_pe_sections(payload);
    let text = find_section(&sections, ".text").ok_or("missing .text section")?;

    let known: &[&str] = &[".text", ".rdata", ".data", ".pdata", ".fptable", ".rsrc", ".reloc"];
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
            && ((data[i] == 0x8B && data[i + 1] == 0x0D) || (data[i] == 0x31 && data[i + 1] == 0xC9))
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
        if data[b] != 0xE9 || data[b + 1] != 0 || data[b + 2] != 0 || data[b + 3] != 0 || data[b + 4] != 0 {
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
    ResolvedPatch { offset, original, replacement }
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

fn apply_patches(data: &[u8], patches: &[ResolvedPatch]) -> Result<(Vec<u8>, usize, usize), String> {
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
            return Err(format!("byte mismatch at 0x{:X} — wrong SteamTools version?", p.offset));
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

    let needs_repair = HIJACK_CANDIDATES.iter().all(|n| !sp.join(n).exists());

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

    let cache_path = find_cache_path(steam_path)
        .ok_or("Payload cache not found — launch Steam with SteamTools at least once to download it")?;
    let (payload, iv) = read_and_decrypt_payload(&cache_path)?;
    let resolved = resolver(&payload)?;
    let (patched_payload, applied, _skipped) = apply_patches(&payload, &resolved)?;

    if let Some((dll_path, patched_dll)) = dll_output {
        robust_write(&dll_path, &patched_dll).map_err(|e| format!("DLL write: {}", e))?;
        res.dll_patched = true;
    }

    if applied > 0 {
        reencrypt_and_write(&cache_path, &patched_payload, &iv)?;
    }
    res.cache_patched = true;
    res.succeeded = true;
    res.message = "Done.".to_string();
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

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, data);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

async fn restore_dlls(steam_path: &Path) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .user_agent("Veil/2.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let hashes: HashMap<String, String> = match client.get(HASHES_URL).send().await {
        Ok(resp) => resp.json().await.unwrap_or_default(),
        Err(_) => HashMap::new(),
    };

    let targets = [("xinput1_4.dll", XINPUT_URL), ("dwmapi.dll", DWMAPI_URL)];
    let mut restored = false;
    for (name, url) in targets {
        let path = steam_path.join(name);
        if !path.exists() {
            continue;
        }
        let data = client
            .get(url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("download {}: {}", name, e))?
            .bytes()
            .await
            .map_err(|e| format!("download {}: {}", name, e))?
            .to_vec();
        if data.is_empty() {
            return Err(format!("{}: downloaded empty file", name));
        }
        if let Some(expected) = hashes.get(name) {
            if !sha256_hex(&data).eq_ignore_ascii_case(expected) {
                return Err(format!("{}: hash mismatch after download", name));
            }
        }
        robust_write(&path, &data).map_err(|e| format!("write {}: {}", name, e))?;
        restored = true;
    }
    Ok(restored)
}

#[tauri::command]
pub async fn patcher_restore(steam_path: String) -> Result<PatchActionResult, String> {
    let sp = PathBuf::from(&steam_path);
    let mut actions: Vec<&str> = Vec::new();

    if let Some(cache_path) = find_cache_path(&sp) {
        if cache_path.exists() {
            let _ = retry_io(|| fs::remove_file(&cache_path));
            actions.push("payload cache cleared");
        }
    }

    let dll_patched = restore_dlls(&sp).await?;
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

// ──────────────────────────────────────────────────────────────────────────
// CloudRedirect: hook the payload's cloud SendPkt to load cloud_redirect.dll
// and route cloud save packets through it. The payload (loaded by Steam every
// launch via Veil's proxy DLL) is patched with a small code cave; the cave
// LoadLibrary's the DLL and calls its CloudOnSendPkt export. This is what makes
// Steam load the DLL on every start without any standalone process running.
// ──────────────────────────────────────────────────────────────────────────

const SENDPKT_ORIGINAL: [u8; 5] = [0x48, 0x89, 0x5C, 0x24, 0x20];

// 144-byte cave. Four displacements (LoadLibraryA IAT, GetProcAddress IAT,
// recvPkt global, jmp-back) are filled in per-payload by build_cloud_cave.
const CLOUD_CAVE: [u8; 144] = [
    // [0x00] save volatile regs + rbx
    0x51, 0x52, 0x41, 0x50, 0x53, 0x48, 0x83, 0xEC, 0x28,
    // [0x09] lea rcx, [rip+0x5E] -> "cloud_redirect.dll"
    0x48, 0x8D, 0x0D, 0x5E, 0x00, 0x00, 0x00,
    // [0x10] call [rip+XX] -> LoadLibraryA  (disp @0x12)
    0xFF, 0x15, 0x00, 0x00, 0x00, 0x00,
    0x48, 0x85, 0xC0, 0x74, 0x34,
    // [0x1B] lea rdx, [rip+0x5F] -> "CloudOnSendPkt"
    0x48, 0x8D, 0x15, 0x5F, 0x00, 0x00, 0x00,
    0x48, 0x8B, 0xC8,
    // [0x25] call [rip+XX] -> GetProcAddress  (disp @0x27)
    0xFF, 0x15, 0x00, 0x00, 0x00, 0x00,
    0x48, 0x85, 0xC0, 0x74, 0x1F,
    0x48, 0x8B, 0xD8,
    0x48, 0x8B, 0x4C, 0x24, 0x40,
    0x48, 0x8B, 0x54, 0x24, 0x38,
    0x4C, 0x8B, 0x44, 0x24, 0x30,
    // [0x42] lea r9, [rip+XX] -> recvPkt global  (disp @0x45)
    0x4C, 0x8D, 0x0D, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xD3, 0x85, 0xC0, 0x75, 0x13,
    // [0x4F] fallthrough: restore + original prologue + jmp back
    0x48, 0x83, 0xC4, 0x28, 0x5B, 0x41, 0x58, 0x5A, 0x59,
    0x48, 0x89, 0x5C, 0x24, 0x20,
    // [0x5D] jmp SendPkt+5  (disp @0x5E)
    0xE9, 0x00, 0x00, 0x00, 0x00,
    // [0x62] handled: clean up and return 1
    0x48, 0x83, 0xC4, 0x28, 0x5B, 0x41, 0x58, 0x5A, 0x59,
    0xB0, 0x01, 0xC3,
    // [0x6E] "cloud_redirect.dll\0"
    0x63, 0x6C, 0x6F, 0x75, 0x64, 0x5F, 0x72, 0x65,
    0x64, 0x69, 0x72, 0x65, 0x63, 0x74, 0x2E, 0x64,
    0x6C, 0x6C, 0x00,
    // [0x81] "CloudOnSendPkt\0"
    0x43, 0x6C, 0x6F, 0x75, 0x64, 0x4F, 0x6E, 0x53,
    0x65, 0x6E, 0x64, 0x50, 0x6B, 0x74, 0x00,
];

fn build_cloud_cave(
    cave_rva: i64,
    sendpkt_rva: i64,
    loadlib_iat_rva: i64,
    getproc_iat_rva: i64,
    recvpkt_global_rva: i64,
) -> [u8; 144] {
    let mut cave = CLOUD_CAVE;
    let put = |buf: &mut [u8; 144], at: usize, v: i32| {
        buf[at..at + 4].copy_from_slice(&v.to_le_bytes());
    };
    put(&mut cave, 0x12, (loadlib_iat_rva - (cave_rva + 0x16)) as i32);
    put(&mut cave, 0x27, (getproc_iat_rva - (cave_rva + 0x2B)) as i32);
    put(&mut cave, 0x45, (recvpkt_global_rva - (cave_rva + 0x49)) as i32);
    put(&mut cave, 0x5E, ((sendpkt_rva + 5) - (cave_rva + 0x62)) as i32);
    cave
}

/// Locate the cloud SendPkt function via its alloca probe (B8 00 11 00 00 E8),
/// walking back 0x18 to the prologue.
fn find_sendpkt(data: &[u8], t_start: usize, t_end: usize) -> Option<usize> {
    let needle = [0xB8, 0x00, 0x11, 0x00, 0x00, 0xE8];
    let mut pos = t_start;
    while pos < t_end {
        let hit = scan_for_bytes(data, pos, t_end, &needle)?;
        if hit >= 0x18 {
            let func = hit - 0x18;
            if func >= t_start
                && (bytes_match(data, func, &SENDPKT_ORIGINAL) || data[func] == 0xE9)
            {
                return Some(func);
            }
        }
        pos = hit + 1;
    }
    None
}

/// Find a zero-filled tail in an executable PE section large enough for the cave.
fn find_code_cave(data: &[u8], sections: &[PeSection], required: usize) -> Option<usize> {
    for sec in sections {
        if !sec.is_executable() {
            continue;
        }
        let raw_start = sec.raw_offset;
        let raw_end = (sec.raw_offset + sec.raw_size).min(data.len());
        if raw_end <= raw_start {
            continue;
        }
        let mut zero_run = 0usize;
        let mut i = raw_end;
        while i > raw_start {
            i -= 1;
            if data[i] == 0 {
                zero_run += 1;
            } else {
                break;
            }
        }
        if zero_run >= required {
            return Some(raw_end - zero_run);
        }
    }
    None
}

/// Locate recvPktGlobal: `lea rcx, SendPkt` then the following `mov cs:qword, rcx`.
fn find_recvpkt_global_rva(
    data: &[u8],
    sections: &[PeSection],
    sendpkt_rva: usize,
    search_start: usize,
    search_end: usize,
) -> Option<usize> {
    let end = search_end.min(data.len());
    if end < 7 {
        return None;
    }
    let mut i = search_start;
    while i < end - 7 {
        if data[i] == 0x48 && data[i + 1] == 0x8D && data[i + 2] == 0x0D {
            let rel = i32::from_le_bytes(data[i + 3..i + 7].try_into().ok()?);
            if let Some(instr_rva) = file_offset_to_rva(sections, i) {
                let target = instr_rva as i64 + 7 + rel as i64;
                if target == sendpkt_rva as i64 {
                    let j_end = (i + 0x100).min(end);
                    let mut j = i + 7;
                    while j + 7 < j_end {
                        if data[j] == 0x48 && data[j + 1] == 0x89 && data[j + 2] == 0x0D {
                            let mov_rel = i32::from_le_bytes(data[j + 3..j + 7].try_into().ok()?);
                            if let Some(mov_rva) = file_offset_to_rva(sections, j) {
                                return Some((mov_rva as i64 + 7 + mov_rel as i64) as usize);
                            }
                        }
                        j += 1;
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn read_u32(data: &[u8], off: usize) -> Option<u32> {
    data.get(off..off + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

/// Find LoadLibraryA and GetProcAddress IAT entry RVAs in the KERNEL32 imports.
fn find_kernel32_iat(pe: &[u8], sections: &[PeSection]) -> Option<(usize, usize)> {
    if pe.len() < 64 {
        return None;
    }
    let pe_off = read_u32(pe, 0x3C)? as usize;
    if pe_off + 24 > pe.len() {
        return None;
    }
    let magic = u16::from_le_bytes([pe[pe_off + 24], pe[pe_off + 25]]);
    let import_dir_off = match magic {
        0x20B => pe_off + 24 + 120,
        0x10B => pe_off + 24 + 104,
        _ => return None,
    };
    let import_rva = read_u32(pe, import_dir_off)? as usize;
    if import_rva == 0 {
        return None;
    }
    let import_file = rva_to_file_offset(sections, import_rva)?;
    let thunk_size = if magic == 0x20B { 8 } else { 4 };

    let mut desc = import_file;
    while desc + 20 <= pe.len() {
        let name_rva = read_u32(pe, desc + 12)? as usize;
        if name_rva == 0 {
            break;
        }
        let name_off = match rva_to_file_offset(sections, name_rva) {
            Some(o) if o < pe.len() => o,
            _ => {
                desc += 20;
                continue;
            }
        };
        let mut dll_name = String::new();
        let mut k = name_off;
        while k < pe.len() && pe[k] != 0 {
            dll_name.push(pe[k] as char);
            k += 1;
        }
        if !dll_name.eq_ignore_ascii_case("KERNEL32.dll") {
            desc += 20;
            continue;
        }

        let mut oft_rva = read_u32(pe, desc)? as usize;
        let ft_rva = read_u32(pe, desc + 16)? as usize;
        if oft_rva == 0 {
            oft_rva = ft_rva;
        }
        let oft_off = rva_to_file_offset(sections, oft_rva)?;

        let (mut load_lib, mut get_proc) = (None, None);
        let mut ti = 0usize;
        loop {
            let int_off = oft_off + ti * thunk_size;
            if int_off + thunk_size > pe.len() {
                break;
            }
            let thunk_val: u64 = if thunk_size == 8 {
                u64::from_le_bytes(pe[int_off..int_off + 8].try_into().ok()?)
            } else {
                read_u32(pe, int_off)? as u64
            };
            if thunk_val == 0 {
                break;
            }
            let is_ordinal = if thunk_size == 8 {
                thunk_val & 0x8000_0000_0000_0000 != 0
            } else {
                thunk_val & 0x8000_0000 != 0
            };
            if !is_ordinal {
                let hint_name_rva = (thunk_val & 0xFFFF_FFFF) as usize;
                if let Some(hint_off) = rva_to_file_offset(sections, hint_name_rva) {
                    let fn_start = hint_off + 2;
                    let mut fname = String::new();
                    let mut m = fn_start;
                    while m < pe.len() && pe[m] != 0 {
                        fname.push(pe[m] as char);
                        m += 1;
                    }
                    let iat_rva = ft_rva + ti * thunk_size;
                    if fname == "LoadLibraryA" {
                        load_lib = Some(iat_rva);
                    } else if fname == "GetProcAddress" {
                        get_proc = Some(iat_rva);
                    }
                    if let (Some(a), Some(b)) = (load_lib, get_proc) {
                        return Some((a, b));
                    }
                }
            }
            ti += 1;
        }
        break;
    }
    None
}

struct CloudResolve {
    sendpkt_off: usize,
    sendpkt_repl: [u8; 5],
    cave_off: usize,
    cave_bytes: [u8; 144],
}

fn resolve_cloud_redirect(payload: &[u8]) -> Result<CloudResolve, String> {
    let sections = parse_pe_sections(payload);
    let (t_start, t_end, g_start, g_end) = resolve_payload_sections(payload)?;

    let sendpkt = find_sendpkt(payload, t_start, t_end)
        .ok_or("Payload: could not locate cloud SendPkt function")?;
    let already = payload[sendpkt] == 0xE9;
    if !already && !bytes_match(payload, sendpkt, &SENDPKT_ORIGINAL) {
        return Err("Payload: unexpected bytes at SendPkt — unsupported version".to_string());
    }

    let sendpkt_rva = file_offset_to_rva(&sections, sendpkt)
        .ok_or("Payload: SendPkt RVA resolution failed")?;

    let cave_off = if already {
        let disp = i32::from_le_bytes(payload[sendpkt + 1..sendpkt + 5].try_into().unwrap());
        let existing_cave_rva = (sendpkt_rva as i64 + 5 + disp as i64) as usize;
        rva_to_file_offset(&sections, existing_cave_rva)
            .ok_or("Payload: existing cave RVA does not resolve")?
    } else {
        find_code_cave(payload, &sections, CLOUD_CAVE.len())
            .ok_or("Payload: no code cave large enough found")?
    };
    let cave_rva = file_offset_to_rva(&sections, cave_off)
        .ok_or("Payload: cave RVA resolution failed")?;

    let (loadlib_iat, getproc_iat) = find_kernel32_iat(payload, &sections)
        .ok_or("Payload: KERNEL32 LoadLibraryA/GetProcAddress IAT not found")?;

    let recvpkt_global = find_recvpkt_global_rva(payload, &sections, sendpkt_rva, g_start, g_end)
        .ok_or("Payload: could not locate recvPkt global")?;

    let cave_bytes = build_cloud_cave(
        cave_rva as i64,
        sendpkt_rva as i64,
        loadlib_iat as i64,
        getproc_iat as i64,
        recvpkt_global as i64,
    );

    let jmp_disp = (cave_rva as i64 - (sendpkt_rva as i64 + 5)) as i32;
    let mut sendpkt_repl = [0xE9u8, 0, 0, 0, 0];
    sendpkt_repl[1..5].copy_from_slice(&jmp_disp.to_le_bytes());

    Ok(CloudResolve { sendpkt_off: sendpkt, sendpkt_repl, cave_off, cave_bytes })
}

/// Every payload-cache candidate in httpcache/3b. Steam loads exactly the one
/// matching its CPU fingerprint, but stale copies of other versions linger in
/// the same folder — so we patch them all rather than guess which is live.
fn find_all_cache_paths(steam_path: &Path) -> Vec<PathBuf> {
    let cache_dir = steam_path.join("appcache").join("httpcache").join("3b");
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().len() != 16 {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if (500_000..5_000_000).contains(&meta.len()) {
                    out.push(entry.path());
                }
            }
        }
    }
    out
}

enum CloudPatchOutcome {
    Incompatible,
    AlreadyPatched,
    Patched,
}

/// Apply the cloud-redirect hook to a single payload cache file.
fn patch_one_payload(cache_path: &Path) -> Result<CloudPatchOutcome, String> {
    let (mut payload, iv) = match read_and_decrypt_payload(cache_path) {
        Ok(v) => v,
        Err(_) => return Ok(CloudPatchOutcome::Incompatible), // not an encrypted payload
    };
    if payload.len() < 2 || &payload[0..2] != b"MZ" {
        return Ok(CloudPatchOutcome::Incompatible);
    }

    // Already hooked — just make sure it's locked against Steam cache refreshes.
    if let Ok((t_start, t_end, _, _)) = resolve_payload_sections(&payload) {
        if matches!(find_sendpkt(&payload, t_start, t_end), Some(o) if payload[o] == 0xE9) {
            lock_readonly(cache_path);
            return Ok(CloudPatchOutcome::AlreadyPatched);
        }
    }

    // P1/P2/P3: disable SteamTools' own cloud redirect so ours wins. Best-effort.
    if let Ok(resolved) = resolve_capcom_patches(&payload) {
        if let Ok((p, _, _)) = apply_patches(&payload, &resolved) {
            payload = p;
        }
    }

    let resolved = resolve_cloud_redirect(&payload)?;
    if resolved.cave_off + resolved.cave_bytes.len() > payload.len() {
        return Err("Payload too small for code cave".to_string());
    }
    payload[resolved.sendpkt_off..resolved.sendpkt_off + 5].copy_from_slice(&resolved.sendpkt_repl);
    payload[resolved.cave_off..resolved.cave_off + resolved.cave_bytes.len()]
        .copy_from_slice(&resolved.cave_bytes);

    reencrypt_and_write(cache_path, &payload, &iv)?;
    // Lock so Steam can't overwrite/evict the patched cache on its next launch.
    // Veil's own writer (robust_write) clears this attribute before re-patching.
    lock_readonly(cache_path);
    Ok(CloudPatchOutcome::Patched)
}

/// Patch the core DLL + every payload cache so cloud_redirect.dll is loaded and
/// cloud saves are routed through it, regardless of which payload Steam loads.
/// Returns Ok(true) when a payload was actually (re)written this call.
pub fn cloud_redirect_apply(steam_path: &Path) -> Result<bool, String> {
    // Core DLL patches (download-call NOP + hash-check bypass) — Veil may have
    // already applied these; apply_patches is idempotent.
    if let Some(dll_name) = find_core_dll(steam_path) {
        let dll_path = steam_path.join(&dll_name);
        if let Ok(dll_data) = fs::read(&dll_path) {
            if let Ok(resolved) = resolve_core_patches(&dll_data) {
                if let Ok((patched, applied, _)) = apply_patches(&dll_data, &resolved) {
                    if applied > 0 {
                        robust_write(&dll_path, &patched)
                            .map_err(|e| format!("core DLL write: {}", e))?;
                    }
                }
            }
        }
    }

    let candidates = find_all_cache_paths(steam_path);
    if candidates.is_empty() {
        return Err("Payload cache not found — enable Veil and launch Steam once first".to_string());
    }

    let mut compatible = 0;
    let mut changed = false;
    let mut last_err = String::new();
    for cache_path in &candidates {
        match patch_one_payload(cache_path) {
            Ok(CloudPatchOutcome::Incompatible) => {}
            Ok(CloudPatchOutcome::AlreadyPatched) => compatible += 1,
            Ok(CloudPatchOutcome::Patched) => {
                compatible += 1;
                changed = true;
            }
            Err(e) => last_err = e,
        }
    }

    if compatible == 0 {
        return Err(if last_err.is_empty() {
            "No compatible SteamTools payload found to patch".to_string()
        } else {
            last_err
        });
    }
    Ok(changed)
}

/// Revert one payload: unlock it, zero the cave, restore the SendPkt prologue.
fn revert_one_payload(cache_path: &Path) -> Result<(), String> {
    // Drop the lock so Steam manages this cache normally again after disabling.
    clear_readonly(cache_path);

    let (mut payload, iv) = read_and_decrypt_payload(cache_path)?;
    let sections = parse_pe_sections(&payload);
    let (t_start, t_end, _, _) = resolve_payload_sections(&payload)?;

    let sendpkt = match find_sendpkt(&payload, t_start, t_end) {
        Some(s) => s,
        None => return Ok(()),
    };
    if payload[sendpkt] != 0xE9 {
        return Ok(()); // already original
    }

    let disp = i32::from_le_bytes(payload[sendpkt + 1..sendpkt + 5].try_into().unwrap());
    if let Some(sendpkt_rva) = file_offset_to_rva(&sections, sendpkt) {
        let cave_rva = (sendpkt_rva as i64 + 5 + disp as i64) as usize;
        if let Some(cave_off) = rva_to_file_offset(&sections, cave_rva) {
            let end = (cave_off + CLOUD_CAVE.len()).min(payload.len());
            for b in &mut payload[cave_off..end] {
                *b = 0;
            }
        }
    }
    payload[sendpkt..sendpkt + 5].copy_from_slice(&SENDPKT_ORIGINAL);

    reencrypt_and_write(cache_path, &payload, &iv)?;
    Ok(())
}

/// Remove the SendPkt hook from every payload candidate, returning them to the
/// pre-CloudRedirect state. P1/P2/P3 are left intact (Veil's Capcom fix).
pub fn cloud_redirect_revert(steam_path: &Path) -> Result<(), String> {
    for cache_path in find_all_cache_paths(steam_path) {
        let _ = revert_one_payload(&cache_path);
    }
    Ok(())
}

/// Self-heal for Steam client updates: unlock and delete the payload caches so
/// Steam (and Veil's own payload deploy) fetch a fresh, compatible payload. The
/// next apply re-patches whatever lands in their place.
pub fn cloud_redirect_unlock_clear(steam_path: &Path) {
    for cache_path in find_all_cache_paths(steam_path) {
        clear_readonly(&cache_path);
        let _ = retry_io(|| fs::remove_file(&cache_path));
    }
}
