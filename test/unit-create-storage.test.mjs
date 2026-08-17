import assert from 'assert'
import fs from 'fs'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: createStorage建立新Jet4 mdb檔(ADOX); useEncryption為true時建立加密檔
//已存在則回傳'existed'不重建; 建出者為空庫, 資料表需另建
//註: createStorage為本套件之專屬函數, 不在w-orm系列統一規格之範圍內


let fdTmp = './test/temp-create-storage' //各測試檔獨立資料夾, 才可於--parallel下各自建立與移除
let fpPlain = `${fdTmp}/unit-create-plain.mdb`
let fpEnc = `${fdTmp}/unit-create-enc.mdb`

if (isWindows()) {
    describe('WOrmMdb createStorage', function() {

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true }) //先清殘留
            fs.mkdirSync(fdTmp, { recursive: true })
        })

        after(function() {
            cleanStorage(fdTmp)
        })

        it('建立一般mdb檔回傳created且檔案存在', async function() {
            let w = wo(mkOpt(fpPlain))
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'created')
            assert.strict.ok(fs.existsSync(fpPlain), '檔案應存在')
            assert.strict.ok(fs.statSync(fpPlain).size > 0, '檔案應非空')
        })

        it('已存在時回傳existed', async function() {
            let w = wo(mkOpt(fpPlain))
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'existed')
        })

        it('建立加密mdb檔回傳created', async function() {
            let w = wo(mkOpt(fpEnc, {
                url: 'mdb://username:password',
                useEncryption: true,
            }))
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'created')
            assert.strict.ok(fs.existsSync(fpEnc), '檔案應存在')
        })

        it('建出者為空庫, 未建資料表前操作須reject', async function() {
            let w = wo(mkOpt(fpPlain))
            w.on('error', function() {})
            let rt = await w.select()
                .then(() => {
                    return 'resolve'
                })
                .catch(() => {
                    return 'reject'
                })
            assert.strict.strictEqual(rt, 'reject')
        })

    })
}
