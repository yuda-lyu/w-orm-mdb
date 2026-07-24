import assert from 'assert'
import fs from 'fs'
import wo from '../src/WOrmMdb.mjs'


//spec: 依g-js.mjs之預期輸出(其註解區塊)為斷言依據
//storage使用獨立副本, 與其他測試檔可--parallel並行


function isWindows() {
    return process.platform === 'win32'
}

let fdTmp = './test/temp-crud' //各測試檔獨立資料夾, 才可於--parallel下各自建立與移除
let fpStorage = `${fdTmp}/unit-crud.mdb`

let opt = {
    url: 'mdb://:',
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    storage: fpStorage,
}

let rs = [
    { id: 'id-peter', name: 'peter', value: 123 },
    { id: 'id-rosemary', name: 'rosemary', value: 123.456 },
    { id: '', name: 'kettle', value: 456 },
]

let rsm = [
    { id: 'id-peter', name: 'peter(modify)' },
    { id: 'id-rosemary', name: 'rosemary(modify)' },
    { id: '', name: 'kettle(modify)' },
]

if (isWindows()) {
    describe('WOrmMdb crud (connMDB.exe + 內建Jet 4.0)', function() {

        let w = null

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true }) //先清殘留
            fs.mkdirSync(fdTmp, { recursive: true })
            fs.copyFileSync('./test/assets/worm_def.mdb', fpStorage) //專用測試資產, 由node toolg/genTestMdbAssets.mjs產生
            w = wo(opt)
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true }) //移除本測試檔專屬暫存資料夾
            }
            catch (err) {}
        })

        it('delAll於空表回傳{n:0,nDeleted:0,ok:1}', async function() {
            let res = await w.delAll()
            assert.strict.deepStrictEqual(res, { n: 0, nDeleted: 0, ok: 1 })
        })

        it('insert三筆(一筆無id自動給pk)回傳{n:3,nInserted:3,ok:1}', async function() {
            let res = await w.insert(rs)
            assert.strict.deepStrictEqual(res, { n: 3, nInserted: 3, ok: 1 })
        })

        it('save(autoInsert:false)修改兩筆, 無id者不處理', async function() {
            let res = await w.save(rsm, { autoInsert: false })
            assert.strict.deepStrictEqual(res, [
                { n: 1, nModified: 1, ok: 1 },
                { n: 1, nModified: 1, ok: 1 },
                { n: 0, nModified: 0, ok: 1 },
            ])
        })

        it('select全部回傳三筆且內容正確', async function() {
            let ss = await w.select()
            assert.strict.strictEqual(ss.length, 3)
            let peter = ss.find((v) => v.id === 'id-peter')
            assert.strict.deepStrictEqual(peter, { id: 'id-peter', name: 'peter(modify)', value: 123 })
            let rosemary = ss.find((v) => v.id === 'id-rosemary')
            assert.strict.deepStrictEqual(rosemary, { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 })
            let kettle = ss.find((v) => v.name === 'kettle')
            assert.strict.strictEqual(kettle.value, 456)
            assert.strict.strictEqual(kettle.id.length, 32) //autoGenPK隨機id
        })

        it('select依id查詢單筆', async function() {
            let so = await w.select({ id: 'id-rosemary' })
            assert.strict.deepStrictEqual(so, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
        })

        it('select複合條件$and+$gt+$lt', async function() {
            let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
            assert.strict.deepStrictEqual(spa, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
        })

        it('select複合條件$or+$gte+$lte', async function() {
            let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
            assert.strict.strictEqual(spb.length, 1)
            assert.strict.strictEqual(spb[0].name, 'kettle')
        })

        it('select複合條件$or+$and+$ne+$in+$nin', async function() {
            let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
            assert.strict.strictEqual(spc.length, 2)
            assert.strict.strictEqual(spc[0].id, 'id-rosemary')
            assert.strict.strictEqual(spc[1].name, 'kettle')
        })

        it('select以$regex不分大小寫查詢', async function() {
            let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
            assert.strict.deepStrictEqual(sr, [{ id: 'id-peter', name: 'peter(modify)', value: 123 }])
        })

        it('del刪除兩筆各回傳{n:1,nDeleted:1,ok:1}', async function() {
            let ss = await w.select()
            let d = ss.filter((v) => v.name !== 'kettle')
            let res = await w.del(d)
            assert.strict.deepStrictEqual(res, [
                { n: 1, nDeleted: 1, ok: 1 },
                { n: 1, nDeleted: 1, ok: 1 },
            ])
        })

        it('del後僅剩kettle一筆', async function() {
            let ss = await w.select()
            assert.strict.strictEqual(ss.length, 1)
            assert.strict.strictEqual(ss[0].name, 'kettle')
        })

        it('中文數據寫入讀回無損', async function() {
            await w.insert([{ id: 'id-cn', name: '中文標題測試繁體字', value: 123.456789012345 }])
            let sc = await w.select({ id: 'id-cn' })
            assert.strict.strictEqual(sc[0].name, '中文標題測試繁體字')
            assert.strict.strictEqual(sc[0].value, 123.456789012345)
        })

        it('delAll清空全部', async function() {
            let res = await w.delAll()
            assert.strict.strictEqual(res.ok, 1)
            assert.strict.strictEqual(res.n, 2) //kettle + id-cn
            let ss = await w.select()
            assert.strict.deepStrictEqual(ss, [])
        })

    })
}
