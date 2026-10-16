/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tt', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'fDate': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
},
'fBool': {
type: DataTypes.BOOLEAN,
allowNull: true,
autoIncrement: false,
comment: null
},
'fDec': {
type: DataTypes.DECIMAL,
allowNull: true,
autoIncrement: false,
comment: null
},
'fInt': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'fDbl': {
type: DataTypes.DOUBLE,
allowNull: true,
autoIncrement: false,
comment: null
},
'fStr': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'fText': {
type: DataTypes.TEXT,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tt'
});
};
