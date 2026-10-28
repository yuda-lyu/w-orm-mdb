//產生bin/manifest.json(規格M1: 依repo內實檔計算sha256與大小, 不手寫)
//用法: node toolg/genBinManifest.mjs --commit <含bin/實檔之提交(40碼)>
//      主幹模式(mode為floating, 須於主控帳本G10登記)可不給--commit, 自有檔取自master
//流程(規格U1): 替換bin/內檔 → 提交並推GitHub(得提交雜湊) → 本工具 --commit <該提交> → 跑測試(M4) → 發布新版
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'


//---- 各套件之設定(只改這段) ----

//mode, 'pinned'(預設)或'floating'
let mode = 'pinned'

//archives, 自有壓縮檔或分割檔之解出設定, 鍵為清單之name(解出後之檔名):
//  { archive: 'bin/x.zip' } 或 { parts: ['bin/x.zip.001', 'bin/x.zip.002'] }, 另給member(壓縮檔內之路徑)與fpMember(本機解出之該檔, 供計算sha256與大小)
let archives = {
    // 'ffmpeg.exe': { parts: ['bin/ffmpeg.zip.001', 'bin/ffmpeg.zip.002'], member: 'ffmpeg.exe', fpMember: './tmp/ffmpeg/ffmpeg.exe' },
}

//vendors, 廠商檔(規格S3: 不鏡像, 網址須為版本標籤之資產網址, 不得為releases/latest):
//  { name, url, fp(本機已下載之檔), note(規格M3: 已以廠商公告之checksums核對, 或「首次下載自算」與下載日), extract: { member, fpMember }(壓縮檔時) }
let vendors = [
    // { name: 'k6.exe', url: '<版本標籤之資產網址>', fp: './tmp/k6.zip', note: '<核對依據>', extract: { member: '<壓縮檔內路徑>', fpMember: './tmp/k6/k6.exe' } },
]

//---- 以下不需修改 ----

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
let i = process.argv.indexOf('--commit')
let commit = i >= 0 ? String(process.argv[i + 1] || '') : ''
if (mode === 'pinned' && !/^[0-9a-f]{40}$/.test(commit)) {
    console.log('usage: node toolg/genBinManifest.mjs --commit <40 lowercase hexadecimal characters>')
    process.exit(1)
}

//git, 釘選之提交內之bin/須與工作樹相同(不含manifest.json), 否則清單會指到不同內容
let git = (args) => {
    return execFileSync('git', args, { encoding: 'utf8', windowsHide: true })
}
if (commit !== '') {
    git(['cat-file', '-e', `${commit}^{commit}`])
    let diff = git(['diff', '--name-only', commit, '--', 'bin', ':(exclude)bin/manifest.json']).trim()
    if (diff !== '') {
        console.log(`bin/ differs from commit ${commit}:\n${diff}`)
        process.exit(1)
    }
}

//hashFiles, 依序串接多個檔之sha256與大小(分割檔組合後之值)
let hashFiles = async (fps) => {
    let h = crypto.createHash('sha256')
    let size = 0
    for (let fp of fps) {
        for await (let chunk of fs.createReadStream(fp)) {
            size += chunk.length
            h.update(chunk)
        }
    }
    return { sha256: h.digest('hex'), size }
}
let pick = (e) => {
    return { sha256: e.sha256, size: e.size }
}

let files = []
let used = new Set(['bin/manifest.json'])

//自有壓縮檔與分割檔
for (let [name, a] of Object.entries(archives)) {
    let x = await fsGetBinManifestEntry(a.fpMember)
    let extract = { type: 'zip', member: a.member, ...pick(x) }
    if (a.parts) {
        let parts = []
        for (let p of a.parts) {
            used.add(p)
            parts.push(await fsGetBinManifestEntry(p, { path: p }).then((e) => ({ path: e.path, ...pick(e) })))
        }
        files.push({ name, parts, assembled: { type: 'zip', ...(await hashFiles(a.parts)) }, extract })
    }
    else {
        used.add(a.archive)
        let e = await fsGetBinManifestEntry(a.archive, { name, path: a.archive })
        files.push({ ...e, extract })
    }
}

//自有檔: bin/內其餘之檔(git追蹤者)
let tracked = git(['ls-files', '-z', '--', 'bin']).split('\0').filter((v) => v !== '')
for (let p of tracked.sort()) {
    if (!used.has(p)) {
        files.push(await fsGetBinManifestEntry(p, { name: path.posix.basename(p), path: p }))
    }
}

//廠商檔
for (let v of vendors) {
    let e = await fsGetBinManifestEntry(v.fp, { name: v.name, url: v.url })
    let f = { ...e }
    if (v.extract) {
        let x = await fsGetBinManifestEntry(v.extract.fpMember)
        f.extract = { type: 'zip', member: v.extract.member, ...pick(x) }
    }
    if (v.note) {
        f.note = v.note
    }
    files.push(f)
}

let manifest = { schema: 1, pkg: pkg.name, mode, repo: `yuda-lyu/${pkg.name}` }
if (commit !== '') {
    manifest.commit = commit
}
manifest.files = files
fs.writeFileSync('bin/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`bin/manifest.json: ${files.length} file(s)`)
