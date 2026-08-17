import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt, getRt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 T10 事件
//change(mode,data,res)於資料實際異動成功後整批發出一次
//error(mode,data,err)於整批性錯誤之reject前、逐筆失敗於該筆定案後各一次, err為字串
//核心不變式: 操作行為不得因監聽者之有無而改變


let nm = 'event'
let ss = null


//蒐集事件, 事件名與各參數皆記錄以供比對
function mkEvs(w) {
    let evs = []
    w.on('change', function(mode, data, res) {
        evs.push({ ev: 'change', mode, data, res })
    })
    w.on('error', function(mode, data, err) {
        evs.push({ ev: 'error', mode, data, err })
    })
    return evs
}


function names(evs) {
    return evs.map((v) => `${v.ev}:${v.mode}`)
}


if (isWindows()) {
    describe('WOrmMdb event', function() {

        let w = null
        let evs = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            evs = mkEvs(w)
        })

        beforeEach(async function() {
            await w.delAll()
            evs.length = 0
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        describe('T10.2 change事件', function() {

            it('逐筆函數以整批為單位發出一次, 不逐筆發出', async function() {
                await w.insert([{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }])
                await w.del([{ id: 'c1' }, { id: 'c2' }])
                assert.strict.deepStrictEqual(names(evs), ['change:insert', 'change:del'])
            })

            it('七函數之change涵蓋', async function() {
                await w.insert([{ id: 'c1', name: 'A' }])
                await w.insertBulk([{ id: 'c2', name: 'B' }])
                await w.save({ id: 'c1', name: 'A-mod' })
                await w.del({ id: 'c2' })
                await w.delAll()
                assert.strict.deepStrictEqual(names(evs), [
                    'change:insert',
                    'change:insertBulk',
                    'change:save',
                    'change:del',
                    'change:delAll',
                ])
            })

            it('讀取函數不發出change', async function() {
                await w.insert([{ id: 'c1', name: 'A' }])
                evs.length = 0
                await w.select()
                await w.select({ id: 'c1' })
                await w.selectByPk('c1')
                assert.strict.deepStrictEqual(evs, [])
            })

            it('save之逐筆插入另發mode為insert之事件且早於整批save', async function() {
                await w.save({ id: 'i1', name: 'A' })
                assert.strict.deepStrictEqual(names(evs), ['change:insert', 'change:save'])
            })

            it('save之更新路徑不另發insert事件', async function() {
                await w.insert([{ id: 'i1', name: 'A' }])
                evs.length = 0
                await w.save({ id: 'i1', name: 'A-mod' })
                assert.strict.deepStrictEqual(names(evs), ['change:save'])
            })

            it('change之參數形狀為(mode,data,res)', async function() {
                let data = [{ id: 'c1', name: 'A' }]
                let res = await w.insert(data)
                assert.strict.strictEqual(evs.length, 1)
                assert.strict.strictEqual(evs[0].mode, 'insert')
                assert.strict.deepStrictEqual(evs[0].res, res, 'res須為本次回傳結果')
                assert.strict.ok(Array.isArray(evs[0].data), 'data須為本次輸入數據')
                assert.strict.strictEqual(evs[0].data[0].id, 'c1')
            })

            it('delAll之data為null', async function() {
                let res = await w.delAll()
                assert.strict.strictEqual(evs[0].mode, 'delAll')
                assert.strict.strictEqual(evs[0].data, null)
                assert.strict.deepStrictEqual(evs[0].res, res)
            })

            it('整批reject者不發出change', async function() {
                await w.insert([{ id: 'c1', name: 'A' }])
                evs.length = 0
                await getRt(w.insertBulk([{ id: 'c1', name: 'X' }]))
                assert.strict.strictEqual(evs.filter((v) => v.ev === 'change').length, 0)
            })

        })

        describe('T10.3 error事件', function() {

            it('整批性錯誤於reject前發出, err為字串', async function() {
                let wf = wo(mkOpt(ss.fpStorage, { autoGenPk: false }))
                let evsF = mkEvs(wf)
                let rt = await getRt(wf.insert({ name: 'no-id' }))
                assert.strict.strictEqual(rt, 'reject')
                assert.strict.deepStrictEqual(names(evsF), ['error:insert'])
                assert.strict.ok(typeof evsF[0].err === 'string' && evsF[0].err.length > 0)
                assert.strict.ok(evsF[0].data !== null, '有輸入數據者data不得為null')
            })

            it('逐筆失敗於該筆定案後發出, 每筆一次, 且整批仍resolve', async function() {
                await w.insert([{ id: 'd1', name: 'A' }])
                evs.length = 0
                let res = await w.del([{ id: 'd1' }, { name: 'no-pk-a' }, { name: 'no-pk-b' }])
                assert.strict.deepStrictEqual(res.map((v) => v.ok), [1, 0, 0])
                assert.strict.deepStrictEqual(names(evs), ['error:del', 'error:del', 'change:del'])
            })

            it('逐筆error之err與該筆err欄位一致', async function() {
                let res = await w.del([{ name: 'no-pk' }])
                let evErr = evs.find((v) => v.ev === 'error')
                assert.strict.strictEqual(evErr.err, res[0].err)
            })

            it('逐筆error先於整批change發出', async function() {
                await w.insert([{ id: 'd1', name: 'A' }])
                evs.length = 0
                await w.del([{ name: 'no-pk' }, { id: 'd1' }])
                let iErr = names(evs).indexOf('error:del')
                let iCh = names(evs).indexOf('change:del')
                assert.strict.ok(iErr >= 0 && iCh >= 0)
                assert.strict.ok(iErr < iCh, 'error須早於change')
            })

            it('save之逐筆失敗發出error:save', async function() {
                await w.insert([{ id: 's1', name: 'A', value: 1 }])
                evs.length = 0
                let res = await w.save([{ id: 's1', value: 'not-a-number' }])
                assert.strict.strictEqual(res[0].ok, 0)
                assert.strict.deepStrictEqual(names(evs), ['error:save', 'change:save'])
            })

            it('讀取函數之錯誤亦發出error', async function() {
                //指向不存在之mdb檔, Jet無從開啟故讀取須reject且發出error
                let wb = wo(mkOpt(`${ss.fdTmp}/no-such-file.mdb`))
                let evsB = mkEvs(wb)
                assert.strict.strictEqual(await getRt(wb.select()), 'reject')
                assert.strict.deepStrictEqual(names(evsB), ['error:select'])
                assert.strict.strictEqual(evsB[0].data, null, '無輸入數據者data為null')
                assert.strict.ok(typeof evsB[0].err === 'string' && evsB[0].err.length > 0, 'err須為字串')

                evsB.length = 0
                assert.strict.strictEqual(await getRt(wb.selectByPk('x')), 'reject')
                assert.strict.deepStrictEqual(names(evsB), ['error:selectByPk'])
                assert.strict.strictEqual(evsB[0].data, null)
            })

            it('正常結果不得發出error', async function() {
                await w.insert([{ id: 'n1', name: 'A', value: 1 }])
                evs.length = 0
                await w.insert([{ id: 'n1', name: 'A2' }]) //已存在, nInserted為0
                await w.save({ id: 'n1', name: 'A', value: 1 }) //合併後內容相同, 不寫入
                await w.save({ id: 'n2', name: 'B' }, { autoInsert: false }) //不存在且不autoInsert
                await w.del({ id: 'n-none' }) //主鍵未命中
                await w.delAll({ name: 'nobody' }) //條件無命中
                await w.selectByPk('n-none') //查無數據
                await w.select({ name: 'nobody' }) //查無數據
                assert.strict.strictEqual(evs.filter((v) => v.ev === 'error').length, 0)
            })

        })

        describe('T10.1 共同要求', function() {

            it('核心不變式: 有無註冊error監聽之回傳值完全相同', async function() {
                let run = async function(withListener) {
                    let wx = wo(mkOpt(ss.fpStorage, { autoGenPk: false }))
                    if (withListener) {
                        wx.on('error', function() {})
                    }
                    await wx.delAll()

                    let r = {}

                    //整批性錯誤
                    r.batch = await wx.insert({ name: 'no-id' })
                        .then((msg) => {
                            return { type: 'resolve', msg }
                        })
                        .catch(() => {
                            return { type: 'reject' }
                        })

                    //逐筆失敗
                    await wx.insert([{ id: 'x1', name: 'A' }])
                    r.each = await wx.del([{ id: 'x1' }, { name: 'no-id' }])
                        .then((msg) => {
                            return {
                                type: 'resolve',
                                msg: msg.map((v) => ({ n: v.n, nDeleted: v.nDeleted, ok: v.ok })),
                            }
                        })
                        .catch(() => {
                            return { type: 'reject' }
                        })

                    return r
                }

                let rWith = await run(true)
                let rWithout = await run(false)
                assert.strict.deepStrictEqual(rWithout, rWith, '有無監聽之結果須完全相同')
                assert.strict.strictEqual(rWithout.batch.type, 'reject', '未註冊監聽時整批性錯誤仍reject')
                assert.strict.strictEqual(rWithout.each.type, 'resolve', '未註冊監聽時逐筆失敗仍resolve')
            })

            it('訂閱函數拋錯不得影響本次操作', async function() {
                let wt = wo(mkOpt(ss.fpStorage))
                wt.on('change', function() {
                    throw new Error('listener boom')
                })
                wt.on('error', function() {
                    throw new Error('listener boom')
                })
                await wt.delAll()

                let res = await wt.insert({ id: 't1', name: 'A', value: 1 })
                assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })

                let resDel = await wt.del([{ name: 'no-pk' }])
                assert.strict.strictEqual(resDel[0].ok, 0)
                assert.strict.strictEqual(resDel.length, 1)
            })

            it('移除全部事件後呼叫端仍能取得完整資訊', async function() {
                //事件不得為唯一管道: 整批性錯誤經reject, 逐筆失敗經該筆err欄位
                let wn = wo(mkOpt(ss.fpStorage, { autoGenPk: false }))
                await wn.delAll()

                let errBatch = null
                await wn.insert({ name: 'no-id' })
                    .catch((e) => {
                        errBatch = e
                    })
                assert.strict.ok(errBatch !== null, '整批性錯誤須經reject送達')

                let res = await wn.del([{ name: 'no-pk' }])
                assert.strict.ok(typeof res[0].err === 'string' && res[0].err.length > 0, '逐筆失敗須經err欄位送達')
            })

        })

    })
}
