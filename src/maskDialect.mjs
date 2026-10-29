//建構函式訊息[dialect[…] is not mdb]之dialect回顯(R-DIAG-06): 本套件專屬(連線字串之回顯改用wsemi之maskDiagUrl, 見dspec〈診斷輸出與遮罩〉Q2); 策略與maskDiagUrl一致(語料R13): 只回顯已知方言名, 其餘一律***


//遮罩字串
const MASK = '***'


//已知方言名: 本套件的mdb, 及w-orm-reladb(WOrmReladb.mjs之DIALECTS)的mssql、sqlite、mysql、mariadb、postgres; 比對不分大小寫, 回顯此處宣告之小寫形(不回顯輸入之寫法)
const DIALECTS = ['mdb', 'mssql', 'sqlite', 'mysql', 'mariadb', 'postgres']


function maskDialect(url) {
    //連線字串之dialect(第一個://之前)的可回顯形式: 純函數
    //有://且://之前不分大小寫等於已知方言名者回該方言名(小寫), 其餘(未知方言、看似scheme之秘密、無://、非字串)一律***
    if (typeof url !== 'string') {
        return MASK
    }
    let i = url.indexOf('://')
    if (i < 0) {
        return MASK
    }
    let name = url.slice(0, i).toLowerCase()
    return DIALECTS.includes(name) ? name : MASK
}


export default maskDialect
