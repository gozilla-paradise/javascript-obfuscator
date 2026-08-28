'use strict';

const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const packageJson = require('pjson');

module.exports = {
    devtool: 'source-map',
    entry: './web/src/main.ts',
    target: 'web',
    module: {
        exprContextCritical: false,
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                options: {
                    configFile: path.resolve(__dirname, '../web/tsconfig.json'),
                    compilerOptions: {
                        noEmit: false
                    }
                }
            }
        ]
    },
    resolve: {
        alias: {
            assert: 'assert'
        },
        extensions: ['.ts', '.js']
    },
    plugins: [
        new webpack.EnvironmentPlugin({
            VERSION: packageJson.version
        }),
        new webpack.ProvidePlugin({
            process: ['process']
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: path.resolve(__dirname, '../web/index.html'), to: 'index.html' },
                { from: path.resolve(__dirname, '../web/styles.css'), to: 'styles.css' },
                { from: require.resolve('esbuild-wasm/esbuild.wasm'), to: 'assets/esbuild.wasm' }
            ]
        })
    ],
    output: {
        path: path.resolve(__dirname, '../dist/web'),
        filename: 'app.js',
        chunkFilename: '[name].[contenthash].worker.js',
        publicPath: 'auto',
        clean: true
    },
    performance: {
        hints: false
    },
    stats: {
        excludeModules: true
    }
};
