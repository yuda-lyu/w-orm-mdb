import assert from 'assert'
import fs from 'fs'
import wo from '../src/WOrmMdb.mjs'


//spec: 依g-js-encryption.mjs之預期輸出為斷言依據
//加密檔密碼組成為`${username}:${password}`(worm_encryption_def.mdb為username:password)


function isWindows() {
    return process.platform === 'win32'
}

let fdTmp = './test/temp-encryption' //各測試檔獨立資料夾, 才可於--parallel下各自建立與移除
let fpStorage = `${fdTmp}/unit-encryption.mdb`

let opt = {
    url: 'mdb://username:password',
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    storage: fpStorage,
    useEncryption: true,
}

if (isWindows()) {
    describe('WOrmMdb encryption (內建Jet 4.0)', function() {

        let w = null

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true }) //先清殘留
            fs.mkdirSync(fdTmp, { recursive: true })
            fs.copyFileSync('./test/assets/worm_encryption_def.mdb', fpStorage) //專用測試資產, 由node toolg/genTestMdbAssets.mjs產生
            w = wo(opt)
            w.on('error', function() {}) //錯誤斷言於rejection, 不需console
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true }) //移除本測試檔專屬暫存資料夾
            }
            catch (err) {}
        })

        it('加密檔insert+select中文數據正確', async function() {
            let res = await w.insert([{ id: 'id-enc', name: '加密檔中文寫入', value: 456.789 }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
            let ss = await w.select({ id: 'id-enc' })
            assert.strict.deepStrictEqual(ss, [{ id: 'id-enc', name: '加密檔中文寫入', value: 456.789 }])
        })

        it('加密檔save修改數據', async function() {
            let res = await w.save([{ id: 'id-enc', name: '更新後的中文' }], { autoInsert: false })
            assert.strict.deepStrictEqual(res, [{ n: 1, nModified: 1, ok: 1 }])
            let ss = await w.select({ id: 'id-enc' })
            assert.strict.strictEqual(ss[0].name, '更新後的中文')
        })

        it('加密檔delAll清空', async function() {
            let res = await w.delAll()
            assert.strict.strictEqual(res.ok, 1)
            let ss = await w.select()
            assert.strict.deepStrictEqual(ss, [])
        })

        it('錯誤密碼開啟加密檔被拒(Not a valid password)', async function() {
            let optBad = { ...opt, url: 'mdb://username:wrongpwd' }
            let wBad = wo(optBad)
            wBad.on('error', function() {})
            let err = null
            await wBad.select()
                .catch((e) => {
                    err = e
                })
            assert.strict.ok(err !== null, '應被拒絕')
            assert.strict.ok(String(err).indexOf('Not a valid password') >= 0, `錯誤訊息應含Not a valid password, 實得: ${err}`)
        })

    })
}
