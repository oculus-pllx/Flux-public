const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const AlertHistory = sequelize.define('AlertHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  triggerId: { type: DataTypes.INTEGER, allowNull: false },
  deviceId: { type: DataTypes.INTEGER, allowNull: false },
  message: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.FLOAT, allowNull: true },
  severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), defaultValue: 'warning' },
  resolved: { type: DataTypes.BOOLEAN, defaultValue: false },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  resolvedBy: { type: DataTypes.INTEGER, allowNull: true },
})

module.exports = AlertHistory
