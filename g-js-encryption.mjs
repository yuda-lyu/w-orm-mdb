import fs from 'fs'
import wo from './src/WOrmMdb.mjs'


let username = 'username'
let password = 'password'
let opt = {
    url: `mdb://${username}:${password}`, //加密檔之密碼組成為`${username}:${password}`
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'js', //default
    // pk: 'id', //default
    // autoGenPk: true, //default
    storage: './worm.mdb',
    useEncryption: true,
}

//因worm.mdb可能被修改, 先刪除再由worm_encryption_def.mdb複製一份來用
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}
fs.copyFileSync('./worm_encryption_def.mdb', opt.storage) //複製加密版, 密碼為[username:password]

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
]

async function test() {
    //測試加密mdb


    //w
    let w = wo(opt)


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //insertBulk
    await w.insertBulk([{ id: 'id-bulk-1', name: 'bulk1', value: 1 }])
        .then(function(msg) {
            console.log('insertBulk then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //selectByPk
    console.log('selectByPk', await w.selectByPk('id-rosemary'))


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select by regex
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)


    //del
    await w.del([{ id: 'id-peter' }])
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll all then', msg)
        })
        .catch(function(msg) {
            console.log('delAll all catch', msg)
        })


}
test().catch((err) => console.log('err:', err))
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change insertBulk
// insertBulk then { n: 1, nInserted: 1, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 }
// ]
// selectByPk { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 },
//   { id: 'id-bulk-1', name: 'bulk1', value: 1 }
// ]
// selectReg [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
// change del
// del then [ { n: 1, nDeleted: 1, ok: 1 } ]
// change delAll
// delAll all then { n: 3, nDeleted: 3, ok: 1 }
