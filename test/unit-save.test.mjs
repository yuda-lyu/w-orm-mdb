import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 save(data, option)
//以主鍵為準更新既有數據, 未給之欄位保留; 主鍵不存在且option.autoInsert為true(預設)時改為插入
//[內容相同]之判定基準為: 把待寫入物件合併進現值之後, 結果與現值相同


let nm = 'save'
let ss = null

if (isWindows()) {
    describe('WOrmMdb save', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
        })

        beforeEach(async function() {
            await w.delAll()
            await w.insert([
                { id: 'a', name: 'A', value: 1 },
                { id: 'b', name: 'B', value: 2 },
            ])
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('主鍵存在且合併後內容有變更', async function() {
            let res = await w.save({ id: 'a', name: 'A-mod' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A-mod', value: 1 })
        })

        it('未給之欄位保留現值', async function() {
            await w.save({ id: 'a', name: 'A-mod' })
            assert.strict.strictEqual((await w.selectByPk('a')).value, 1)
        })

        it('主鍵存在且合併後內容與現值相同則不寫入', async function() {
            let res = await w.save({ id: 'a', name: 'A', value: 1 })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('只給部份欄位且該些欄位值皆與現值相同則nModified為0', async function() {
            //判定基準為合併後比對, 非[待寫入物件與現值全等]
            let res = await w.save({ id: 'a', name: 'A' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
            let res2 = await w.save({ id: 'a', value: 1 })
            assert.strict.deepStrictEqual(res2, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('只給主鍵時視為內容相同', async function() {
            let res = await w.save({ id: 'a' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('只給部份欄位而其中一欄有變更則nModified為1', async function() {
            let res = await w.save({ id: 'a', name: 'A', value: 99 })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A', value: 99 })
        })

        it('主鍵不存在且autoInsert為true(預設)時改為插入', async function() {
            let res = await w.save({ id: 'z', name: 'Z', value: 9 })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }])
            assert.strict.deepStrictEqual(await w.selectByPk('z'), { id: 'z', name: 'Z', value: 9 })
        })

        it('主鍵不存在且autoInsert為false時不寫入', async function() {
            let res = await w.save({ id: 'z', name: 'Z', value: 9 }, { autoInsert: false })
            assert.strict.deepStrictEqual(res, [{ n: 0, nInserted: 0, nModified: 0, ok: 1 }])
            assert.strict.strictEqual(await w.selectByPk('z'), null)
        })

        it('autoInsert為false時既有數據仍正常更新', async function() {
            let res = await w.save({ id: 'a', name: 'A-mod' }, { autoInsert: false })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
        })

        it('回傳陣列恆與輸入等長且順序對應', async function() {
            let res = await w.save([
                { id: 'a', name: 'A-mod' }, //更新
                { id: 'b', name: 'B' }, //合併後相同
                { id: 'z1', name: 'Z1' }, //插入
                { id: 'z2', name: 'Z2' }, //插入
            ])
            assert.strict.deepStrictEqual(res, [
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 1, nInserted: 0, nModified: 0, ok: 1 },
                { n: 1, nInserted: 1, nModified: 0, ok: 1 },
                { n: 1, nInserted: 1, nModified: 0, ok: 1 },
            ])
        })

        it('混合autoInsert為false之多筆', async function() {
            let res = await w.save([
                { id: 'a', name: 'A-mod' },
                { id: 'z', name: 'Z' },
            ], { autoInsert: false })
            assert.strict.deepStrictEqual(res, [
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 0, nInserted: 0, nModified: 0, ok: 1 },
            ])
        })

        it('主鍵之命中判定不分大小寫, 與Jet引擎一致', async function() {
            let res = await w.save({ id: 'A', name: 'A-mod' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strict.strictEqual((await w.select()).length, 2, '不得無中生有')
        })

        it('該筆執行失敗時ok為0並附err, 且不中斷整批', async function() {
            //value為DOUBLE欄位, 給予非數值字串會由Jet回報型別不符, 屬該筆之問題
            let res = await w.save([
                { id: 'a', name: 'A-mod' },
                { id: 'b', name: 'B-mod', value: 'not-a-number' },
                { id: 'z', name: 'Z', value: 9 },
            ])
            assert.strict.strictEqual(res.length, 3)
            assert.strict.deepStrictEqual(res[0], { n: 1, nInserted: 0, nModified: 1, ok: 1 })
            assert.strict.strictEqual(res[1].ok, 0, '該筆須失敗')
            assert.strict.ok(typeof res[1].err === 'string' && res[1].err.length > 0, 'ok為0須附err字串')
            assert.strict.deepStrictEqual(res[2], { n: 1, nInserted: 1, nModified: 0, ok: 1 }, '其餘筆數照常處理')
        })

        it('逐筆失敗時整批仍resolve', async function() {
            let rt = await w.save([{ id: 'b', value: 'not-a-number' }])
                .then(() => {
                    return 'resolve'
                })
                .catch(() => {
                    return 'reject'
                })
            assert.strict.strictEqual(rt, 'resolve')
        })

        it('非欄位之鍵被濾除而不影響內容相同之判定', async function() {
            let res = await w.save({ id: 'a', name: 'A', value: 1, notAColumn: 'zz' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('大批次save之逐筆結果精確', async function() {
            let rs = []
            for (let i = 0; i < 100; i++) {
                rs.push({ id: `k${i}`, name: `N${i}`, value: i })
            }
            let res1 = await w.save(rs)
            assert.strict.strictEqual(res1.length, 100)
            assert.strict.strictEqual(res1.filter((v) => v.nInserted === 1).length, 100)

            //再存一次全數內容相同
            let res2 = await w.save(rs)
            assert.strict.strictEqual(res2.filter((v) => v.nModified === 0 && v.n === 1).length, 100)

            //改一半
            let rsm = rs.map((v, k) => {
                return k % 2 === 0 ? { id: v.id, name: `${v.name}-mod` } : { id: v.id, name: v.name }
            })
            let res3 = await w.save(rsm)
            assert.strict.strictEqual(res3.filter((v) => v.nModified === 1).length, 50)
            assert.strict.strictEqual(res3.filter((v) => v.nModified === 0).length, 50)
        })

    })
}
