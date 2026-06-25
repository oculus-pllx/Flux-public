const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const PbsConfig = sequelize.define('PbsConfig', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:            { type: DataTypes.STRING, allowNull: false },
  url:             { type: DataTypes.STRING, allowNull: false },
  tokenId:         { type: DataTypes.STRING, allowNull: false },
  tokenSecret:     { type: DataTypes.TEXT, allowNull: true },
  jobAbortTimeout: { type: DataTypes.INTEGER, defaultValue: 120 },
  forceShutdown:   { type: DataTypes.BOOLEAN, defaultValue: true },
  upsGroupId:      { type: DataTypes.INTEGER, allowNull: true },
  enabled:         { type: DataTypes.BOOLEAN, defaultValue: true },
})

module.exports = PbsConfig
