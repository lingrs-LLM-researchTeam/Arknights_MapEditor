use std::{env, fs, path::Path};

const RT_ICON: u16 = 3;
const RT_GROUP_ICON: u16 = 14;
const DEFAULT_LANGUAGE: u16 = 0x0804;
const MOVEABLE_PURE_DISCARDABLE: u16 = 0x1030;

fn read_u16(data: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or_else(|| "ICO 文件头不完整".to_string())?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or_else(|| "ICO 目录项不完整".to_string())?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn push_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn align_dword(output: &mut Vec<u8>) {
    while output.len() % 4 != 0 {
        output.push(0);
    }
}

fn write_resource(
    output: &mut Vec<u8>,
    type_id: u16,
    name_id: u16,
    language: u16,
    memory_flags: u16,
    data: &[u8],
) {
    push_u32(output, data.len() as u32);
    push_u32(output, 32);
    push_u16(output, 0xffff);
    push_u16(output, type_id);
    push_u16(output, 0xffff);
    push_u16(output, name_id);
    push_u32(output, 0);
    push_u16(output, memory_flags);
    push_u16(output, language);
    push_u32(output, 0);
    push_u32(output, 0);
    output.extend_from_slice(data);
    align_dword(output);
}

fn compile_icon(icon_path: &Path, output_path: &Path) -> Result<(), String> {
    let ico = fs::read(icon_path)
        .map_err(|error| format!("无法读取图标 {}：{error}", icon_path.display()))?;
    if read_u16(&ico, 0)? != 0 || read_u16(&ico, 2)? != 1 {
        return Err("图标文件不是有效的 Windows ICO".to_string());
    }

    let image_count = read_u16(&ico, 4)? as usize;
    if image_count == 0 || ico.len() < 6 + image_count * 16 {
        return Err("ICO 中没有可用的图像".to_string());
    }
    if image_count > u16::MAX as usize {
        return Err("ICO 中的图像数量过多".to_string());
    }

    let mut resource = Vec::new();
    write_resource(&mut resource, 0, 0, 0, 0, &[]);

    let mut group_icon = Vec::with_capacity(6 + image_count * 14);
    push_u16(&mut group_icon, 0);
    push_u16(&mut group_icon, 1);
    push_u16(&mut group_icon, image_count as u16);

    for index in 0..image_count {
        let entry_offset = 6 + index * 16;
        let image_size = read_u32(&ico, entry_offset + 8)? as usize;
        let image_offset = read_u32(&ico, entry_offset + 12)? as usize;
        let image_end = image_offset
            .checked_add(image_size)
            .ok_or_else(|| "ICO 图像大小溢出".to_string())?;
        let image = ico
            .get(image_offset..image_end)
            .ok_or_else(|| "ICO 图像数据超出文件范围".to_string())?;
        let resource_id = (index + 1) as u16;

        write_resource(
            &mut resource,
            RT_ICON,
            resource_id,
            DEFAULT_LANGUAGE,
            MOVEABLE_PURE_DISCARDABLE,
            image,
        );

        group_icon.extend_from_slice(&ico[entry_offset..entry_offset + 8]);
        push_u32(&mut group_icon, image_size as u32);
        push_u16(&mut group_icon, resource_id);
    }

    write_resource(
        &mut resource,
        RT_GROUP_ICON,
        1,
        DEFAULT_LANGUAGE,
        MOVEABLE_PURE_DISCARDABLE,
        &group_icon,
    );
    fs::write(output_path, resource)
        .map_err(|error| format!("无法写入 Windows 图标资源：{error}"))?;
    Ok(())
}

fn main() {
    println!("cargo:rerun-if-env-changed=ARKNIGHTS_APP_ICON");
    let Ok(icon_value) = env::var("ARKNIGHTS_APP_ICON") else {
        return;
    };
    if icon_value.trim().is_empty() {
        return;
    }

    let icon_path = Path::new(&icon_value);
    println!("cargo:rerun-if-changed={}", icon_path.display());
    let output_dir = env::var_os("OUT_DIR").expect("Cargo 未提供 OUT_DIR");
    let resource_path = Path::new(&output_dir).join("app-icon.res");
    compile_icon(icon_path, &resource_path).unwrap_or_else(|error| panic!("{error}"));
    println!("cargo:rustc-link-arg-bins={}", resource_path.display());
}
