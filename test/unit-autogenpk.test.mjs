import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt, getRt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 T6 主鍵補值與autoGenPk
//預設為true; 為false時套件一律不產生主鍵值, 未帶有效主鍵者以Promise.reject拋出整批性錯誤
//del不受本設定影響, 未帶有效主鍵者回該筆ok為0並附err


let nm = 'autogenpk'
let ss = null

if (isWindows()) {
    describe('WOrmMdb autoGenPk', function() {

        let wDef = null
        let wTrue = null
        let wFalse = null

        before(function() {
            ss = setupStorage(nm)
            wDef = wo(mkOpt(ss.fpStorage))
            wTrue = wo(mkOpt(ss.fpStorage, { autoGenPk: true }))
            wFalse = wo(mkOpt(ss.fpStorage, { autoGenPk: false }))
            wDef.on('error', function() {})
            wTrue.on('error', function() {})
            wFalse.on('error', function() {})
        })

        beforeEach(async function() {
            await wDef.delAll()
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        describe('預設與明確給true', function() {

            it('預設為true, insert未帶主鍵時自動補值', async function() {
                let res = await wDef.insert({ name: 'peter', value: 1 })
                assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
                let rs = await wDef.select()
                assert.strict.strictEqual(rs.length, 1)
                assert.strict.ok(typeof rs[0].id === 'string' && rs[0].id.length > 0, '主鍵須被補值')
            })

            it('補值採genIDSeq, 為36碼之UUIDv7字串', async function() {
                await wDef.insert({ name: 'peter' })
                let rs = await wDef.select()
                assert.strict.strictEqual(rs[0].id.length, 36)
            })

            it('明確給true之行為與預設相同', async function() {
                let res = await wTrue.insert([{ name: 'a' }, { name: 'b' }])
                assert.strict.deepStrictEqual(res, { n: 2, nInserted: 2, ok: 1 })
                let rs = await wTrue.select()
                assert.strict.strictEqual(rs.filter((v) => typeof v.id === 'string' && v.id.length === 36).length, 2)
            })

            it('補值之主鍵各不相同', async function() {
                await wDef.insert([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
                let rs = await wDef.select()
                let ids = rs.map((v) => v.id)
                assert.strict.strictEqual(new Set(ids).size, 3)
            })

            it('save未帶主鍵時亦自動補值', async function() {
                let res = await wDef.save({ name: 'peter', value: 1 })
                assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }])
                assert.strict.strictEqual((await wDef.select())[0].id.length, 36)
            })

            it('insertBulk未帶主鍵時亦自動補值', async function() {
                let res = await wDef.insertBulk([{ name: 'a' }, { name: 'b' }])
                assert.strict.deepStrictEqual(res, { n: 2, nInserted: 2, ok: 1 })
                assert.strict.strictEqual((await wDef.select()).length, 2)
            })

            it('已帶有效主鍵者不被覆蓋', async function() {
                await wDef.insert([{ id: 'own-1', name: 'a' }, { name: 'b' }])
                let rs = await wDef.select()
                assert.strict.ok(rs.some((v) => v.id === 'own-1'))
            })

            it('主鍵值為數值0者視為有效而不補值', async function() {
                //以truthy判斷會把0誤判為無效
                let res = await wDef.del([{ id: 0 }])
                assert.strict.strictEqual(res[0].ok, 1, '0須視為有效主鍵值')
            })

        })

        describe('給false', function() {

            it('自備主鍵時正常寫入且沿用呼叫端所給之值', async function() {
                let res = await wFalse.insert([{ id: 'own-1', name: 'a' }, { id: 'own-2', name: 'b' }])
                assert.strict.deepStrictEqual(res, { n: 2, nInserted: 2, ok: 1 })
                let rs = await wFalse.select()
                assert.strict.deepStrictEqual(rs.map((v) => v.id).sort(), ['own-1', 'own-2'])
            })

            it('save自備主鍵時正常處理', async function() {
                await wFalse.insert([{ id: 'own-1', name: 'a', value: 1 }])
                let res = await wFalse.save({ id: 'own-1', name: 'a2' })
                assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            })

            it('insert未帶有效主鍵時reject', async function() {
                assert.strict.strictEqual(await getRt(wFalse.insert({ name: 'no-id' })), 'reject')
            })

            it('insertBulk未帶有效主鍵時reject', async function() {
                assert.strict.strictEqual(await getRt(wFalse.insertBulk({ name: 'no-id' })), 'reject')
            })

            it('save未帶有效主鍵時reject', async function() {
                assert.strict.strictEqual(await getRt(wFalse.save({ name: 'no-id' })), 'reject')
            })

            it('主鍵值為空字串亦視為未帶有效主鍵', async function() {
                assert.strict.strictEqual(await getRt(wFalse.insert({ id: '', name: 'x' })), 'reject')
            })

            it('整批內僅部份未帶有效主鍵時整批reject', async function() {
                assert.strict.strictEqual(await getRt(wFalse.insert([
                    { id: 'own-3', name: 'c' },
                    { name: 'no-id' },
                ])), 'reject')
            })

            it('整批reject時同批之有效筆數亦不得被寫入', async function() {
                //主鍵檢查須於任何寫入之前一次完成
                await wFalse.insert([{ id: 'own-1', name: 'a' }, { id: 'own-2', name: 'b' }])
                await getRt(wFalse.insert([{ id: 'own-3', name: 'c' }, { name: 'no-id' }]))
                let rs = await wFalse.select()
                assert.strict.deepStrictEqual(rs.map((v) => v.id).sort(), ['own-1', 'own-2'])
            })

            it('save整批reject時同批之有效筆數亦不得被寫入', async function() {
                await getRt(wFalse.save([{ id: 'own-9', name: 'c' }, { name: 'no-id' }]))
                assert.strict.deepStrictEqual(await wFalse.select(), [])
            })

            it('del不受本設定影響, 未帶有效主鍵為該筆問題而非整批性錯誤', async function() {
                await wFalse.insert([{ id: 'd1', name: 'x' }])
                let res = await wFalse.del([{ id: 'd1' }, { name: 'no-id' }])
                assert.strict.deepStrictEqual(res.map((v) => ({ n: v.n, nDeleted: v.nDeleted, ok: v.ok })), [
                    { n: 1, nDeleted: 1, ok: 1 },
                    { n: 0, nDeleted: 0, ok: 0 },
                ])
            })

        })

        describe('不得於option逐次覆寫', function() {

            it('option.autoGenPk無效, 仍以建構設定為準', async function() {
                //autoGenPk為建構層設定, 主鍵由誰產生屬整個資料表之政策
                assert.strict.strictEqual(await getRt(wFalse.insert({ name: 'no-id' }, { autoGenPk: true })), 'reject')
            })

        })

    })
}
