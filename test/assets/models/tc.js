/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tc', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'name': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'value': {
type: DataTypes.DOUBLE,
allowNull: true,
autoIncrement: false,
comment: null
},
'n': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'dt': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
},
'b': {
type: DataTypes.BOOLEAN,
allowNull: true,
autoIncrement: false,
comment: null
},
'p$x': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'length': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tc'
});
};
