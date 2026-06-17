const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  value: { type: DataTypes.TEXT, allowNull: true },
})

module.exports = Setting
