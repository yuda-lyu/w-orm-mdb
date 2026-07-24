import assert from 'assert'
import fs from 'fs'
import wo from '../src/WOrmMdb.mjs'


//spec: createStorage建立新Jet4 mdb檔(ADOX); useEncryption=true時建立加密檔
//已存在則回傳'existed'不重建


function isWindows() {
    return process.platform === 'win32'
}

let fdTmp = './test/temp-create-storage' //各測試檔獨立資料夾, 才可於--parallel下各自建立與移除
let fpPlain = `${fdTmp}/unit-create-plain.mdb`
let fpEnc = `${fdTmp}/unit-create-enc.mdb`

if (isWindows()) {
    describe('WOrmMdb createStorage (ADOX + 內建Jet 4.0)', function() {

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true }) //先清殘留
            fs.mkdirSync(fdTmp, { recursive: true })
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true }) //移除本測試檔專屬暫存資料夾
            }
            catch (err) {}
        })

        it('建立一般mdb檔回傳created且檔案存在', async function() {
            let w = wo({ url: 'mdb://:', cl: 'users', fdModels: './models', storage: fpPlain })
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'created')
            assert.strict.ok(fs.existsSync(fpPlain), '檔案應存在')
            assert.strict.ok(fs.statSync(fpPlain).size > 0, '檔案應非空')
        })

        it('已存在時回傳existed', async function() {
            let w = wo({ url: 'mdb://:', cl: 'users', fdModels: './models', storage: fpPlain })
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'existed')
        })

        it('建立加密mdb檔回傳created', async function() {
            let w = wo({ url: 'mdb://username:password', cl: 'users', fdModels: './models', storage: fpEnc, useEncryption: true })
            let res = await w.createStorage()
            assert.strict.strictEqual(res, 'created')
            assert.strict.ok(fs.existsSync(fpEnc), '檔案應存在')
        })

    })
}
