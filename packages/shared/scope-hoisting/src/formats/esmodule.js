// @flow strict-local

import type {Asset, Bundle, BundleGraph, NamedBundle} from '@parcel/types';
import type {ExternalBundle, ExternalModule} from '../types';

import * as t from '@babel/types';
import {isExpressionStatement, isVariableDeclaration} from '@babel/types';
import {relativeBundlePath} from '@parcel/utils';
import {assertString, getName} from '../utils';

export function generateBundleImports(
  bundleGraph: BundleGraph<NamedBundle>,
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
) {
  let specifiers = [...assets].map(asset => {
    let id = getName(asset, 'init');
    return t.importSpecifier(t.identifier(id), t.identifier(id));
  });

  return [
    t.importDeclaration(
      specifiers,
      t.stringLiteral(relativeBundlePath(from, bundle)),
    ),
  ];
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
) {
  let {source, specifiers, isCommonJS} = external;
  let defaultSpecifier = null;
  let namespaceSpecifier = null;
  let namedSpecifiers = [];
  for (let [imported, symbol] of specifiers) {
    if (imported === 'default' || isCommonJS) {
      defaultSpecifier = t.importDefaultSpecifier(t.identifier(symbol));
    } else if (imported === '*') {
      namespaceSpecifier = t.importNamespaceSpecifier(t.identifier(symbol));
    } else {
      namedSpecifiers.push(
        t.importSpecifier(t.identifier(symbol), t.identifier(imported)),
      );
    }
  }

  let statements: Array<BabelNode> = [];

  // ESModule syntax allows combining default and namespace specifiers, or default and named, but not all three.

  if (namespaceSpecifier) {
    let s = [namespaceSpecifier];
    if (defaultSpecifier) {
      s.unshift(defaultSpecifier);
    }
    statements.push(t.importDeclaration(s, t.stringLiteral(source)));
  } else if (defaultSpecifier) {
    namedSpecifiers.unshift(defaultSpecifier);
  }

  if (namedSpecifiers.length > 0 || statements.length === 0) {
    statements.push(
      t.importDeclaration(namedSpecifiers, t.stringLiteral(source)),
    );
  }

  return statements;
}

export function generateBundleExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  reexports: Set<{|exportAs: string, local: string|}>,
) {
  let statements = [];

  if (referencedAssets.size > 0 || reexports.size > 0) {
    statements.push(
      t.exportNamedDeclaration(
        null,
        [...referencedAssets]
          .map(asset => {
            let name = getName(asset, 'init');
            return t.exportSpecifier(t.identifier(name), t.identifier(name));
          })
          .concat(
            [...reexports].map(exp =>
              t.exportSpecifier(
                t.identifier(exp.local),
                t.identifier(exp.exportAs),
              ),
            ),
          ),
      ),
    );
  }

  // If the main entry is a CommonJS asset, export its `module.exports` property as the `default` export
  let entry = bundle.getMainEntry();
  if (entry && entry.meta.isCommonJS === true) {
    statements.push(
      t.exportDefaultDeclaration(
        t.identifier(assertString(entry.meta.exportsIdentifier)),
      ),
    );
  }

  return statements;
}

export function generateMainExport(
  node: BabelNode,
  exported: Array<{|exportAs: string, local: string|}>,
) {
  if (isExpressionStatement(node)) {
    return [node];
  }

  let statements = [];

  let bindingIdentifiers = t.getBindingIdentifiers(node);
  let ids: Array<string> = Object.keys(bindingIdentifiers);
  let defaultExport = exported.find(e => e.exportAs === 'default');
  let namedExports = exported.filter(e => e.exportAs !== 'default');

  // If there's only a default export, then export the declaration directly.
  if (exported.length === 1 && defaultExport && !isVariableDeclaration(node)) {
    // $FlowFixMe - we don't need to worry about type declarations here.
    statements.push(t.exportDefaultDeclaration(node));

    // If there's only named exports, and all of the ids are exported, export the declaration directly.
  } else if (
    namedExports.length === exported.length &&
    namedExports.length === ids.length
  ) {
    statements.push(t.exportNamedDeclaration(node, []));

    // Otherwise, add a default export and named export for the identifiers after the original declaration.
  } else {
    statements.push(node);

    if (defaultExport) {
      statements.push(
        t.exportDefaultDeclaration(t.identifier(defaultExport.local)),
      );
    }

    if (namedExports.length > 0) {
      statements.push(
        t.exportNamedDeclaration(
          null,
          namedExports.map(e =>
            t.exportSpecifier(t.identifier(e.local), t.identifier(e.exportAs)),
          ),
        ),
      );
    }
  }

  return statements;
}
