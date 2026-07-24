import fs from 'fs'
import path from 'path'
import jetOpen from '../src/jet.mjs'


//產生測試專用mdb資產至test/assets/, 供unit測試與CI使用
//透過connMDB.exe(內建Jet 4.0 + ADOX)程式化產生, 可重現
//表結構比照models/users.js: id TEXT(255) PK, name TEXT(255), value DOUBLE
//需於專案根目錄執行: node toolg/genTestMdbAssets.mjs


let fdAssets = './test/assets'

let sqlCreateTable = 'CREATE TABLE [users] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255), [value] DOUBLE)'

async function gen(fn, password) {

    //fp
    let fp = path.resolve(fdAssets, fn)

    //clear
    if (fs.existsSync(fp)) {
        fs.unlinkSync(fp)
    }

    //jet
    let jet = jetOpen({ path: fp, password })

    //create
    await jet.create()

    //create table
    await jet.execute(sqlCreateTable)

    console.log(`generated: ${fp}${password ? ' (encrypted)' : ''}`)
}

async function main() {

    //fdAssets
    if (!fs.existsSync(fdAssets)) {
        fs.mkdirSync(fdAssets, { recursive: true })
    }

    //一般測試檔
    await gen('worm_def.mdb', '')

    //加密測試檔, 密碼組成比照WOrmMdb: `${username}:${password}`
    await gen('worm_encryption_def.mdb', 'username:password')

}

main()
    .catch((err) => {
        console.log('err:', err)
        process.exit(1)
    })
