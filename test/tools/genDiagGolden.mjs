import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { scenario, scenarioWrongPw, normScenario } from './diagScenario.mjs'


//產生診斷輸出測試(R-DIAG)之固定預期值diagGolden.json: 以「修改前」之WOrmMdb(git HEAD)執行共用情境, 取各操作之結果與事件payload
//用法(於專案根目錄): node test/tools/genDiagGolden.mjs <修改前WOrmMdb.mjs之路徑> [輸出檔]
//修改前之程式取得法: git archive HEAD src | tar -x -C <暫存夾>, 其路徑為<暫存夾>/src/WOrmMdb.mjs
//輸出檔預設為test/tools/diagGolden.json; 本檔為產生器而非測試, 重產須經授權(預期值即修改前之回傳契約)


async function main() {
    let fpMod = process.argv[2]
    let fpOut = process.argv[3] || './test/tools/diagGolden.json'
    if (!fpMod) {
        throw new Error('need path of the WOrmMdb.mjs before modification')
    }
    let { default: wo } = await import(pathToFileURL(path.resolve(fpMod)).href)

    let fdTmp = './test/temp-diaggolden'
    let r = {}
    try {
        for (let [nm, bad] of [['plain', false], ['plainBad', true]]) {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdTmp, { recursive: true })
            fs.copyFileSync('./test/assets/worm_def.mdb', `${fdTmp}/g.mdb`)
            let w = wo({ url: 'mdb://:', db: 'worm', cl: 'users', fdModels: './models', storage: `${fdTmp}/g.mdb` })
            r[nm] = normScenario(await scenario(w, bad))
        }

        //加密檔(密碼組成為帳號:密碼, 資產之密碼為username:password), 正確密碼與錯誤密碼
        fs.rmSync(fdTmp, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        fs.copyFileSync('./test/assets/worm_encryption_def.mdb', `${fdTmp}/g.mdb`)
        let wEnc = wo({ url: 'mdb://username:password', db: 'worm', cl: 'users', fdModels: './models', storage: `${fdTmp}/g.mdb`, useEncryption: true })
        r.enc = normScenario(await scenario(wEnc, false))
        let wWrong = wo({ url: 'mdb://username:wrongpw', db: 'worm', cl: 'users', fdModels: './models', storage: `${fdTmp}/g.mdb`, useEncryption: true })
        r.encWrong = normScenario(await scenarioWrongPw(wWrong))
    }
    finally {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    }

    fs.writeFileSync(fpOut, JSON.stringify(r, null, 2), 'utf8')
    console.log('written:', fpOut)
}

main()
    .catch((err) => {
        console.log('err:', err)
        process.exit(1)
    })
