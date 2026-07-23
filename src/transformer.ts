import * as ts from 'typescript';

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  const checker = program.getTypeChecker();

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      function visit(node: ts.Node): ts.Node {
        // 1. Intercept plainToInstance(UserDto, payload)
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          if (ts.isIdentifier(expression) && expression.text === 'plainToInstance') {
            const args = node.arguments;
            if (args.length >= 2) {
              const classArg = args[0];
              const payloadArg = args[1];

              // Resolve the Class DTO declaration
              const type = checker.getTypeAtLocation(classArg);
              const symbol = type.getSymbol() || type.aliasSymbol;
              if (symbol) {
                const declarations = symbol.getDeclarations();
                const classDecl = declarations?.find(ts.isClassDeclaration);
                if (classDecl) {
                  // Compile AST mapping nodes for the properties
                  const propertyAssignments: ts.Statement[] = [];

                  classDecl.members.forEach((member) => {
                    if (ts.isPropertyDeclaration(member)) {
                      const propName = member.name.getText();
                      
                      // Extract decorators compatible with class-transformer
                      const decorators = ts.canHaveDecorators && ts.canHaveDecorators(member)
                        ? ts.getDecorators(member)
                        : (member as any).decorators;

                      let isExposed = false;
                      let isExcluded = false;
                      let typeExpr: ts.Expression | undefined;
                      let transformExpr: ts.Expression | undefined;
                      let exposeName: string | undefined;

                      if (decorators) {
                        for (const decorator of decorators) {
                          const expr = decorator.expression;
                          if (ts.isCallExpression(expr)) {
                            const decoratorName = expr.expression.getText();
                            if (decoratorName === 'Expose') {
                              isExposed = true;
                              const arg = expr.arguments[0];
                              if (arg && ts.isObjectLiteralExpression(arg)) {
                                const nameProp = arg.properties.find(
                                  (p) => p.name?.getText() === 'name'
                                );
                                if (nameProp && ts.isPropertyAssignment(nameProp)) {
                                  exposeName = nameProp.initializer.getText();
                                }
                              }
                            } else if (decoratorName === 'Exclude') {
                              isExcluded = true;
                            } else if (decoratorName === 'Type') {
                              typeExpr = expr.arguments[0];
                            } else if (decoratorName === 'Transform') {
                              transformExpr = expr.arguments[0];
                            }
                          }
                        }
                      }

                      if (isExcluded) return;

                      const sourceKey = exposeName 
                        ? exposeName.replace(/['"`]/g, '') 
                        : propName;
                      const targetKey = propName;

                      // Check if type is Date
                      const memberType = checker.getTypeAtLocation(member);
                      const typeString = checker.typeToString(memberType);
                      const isDate = typeString.includes('Date');

                      const sourceAccess = ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("data"),
                        ts.factory.createIdentifier(sourceKey)
                      );

                      let assignmentExpr: ts.Expression;

                      if (transformExpr) {
                        assignmentExpr = ts.factory.createCallExpression(
                          transformExpr,
                          undefined,
                          [
                            ts.factory.createObjectLiteralExpression([
                              ts.factory.createPropertyAssignment("value", sourceAccess),
                              ts.factory.createPropertyAssignment("key", ts.factory.createStringLiteral(sourceKey)),
                              ts.factory.createPropertyAssignment("obj", ts.factory.createIdentifier("data")),
                              ts.factory.createPropertyAssignment("type", ts.factory.createNumericLiteral(1))
                            ])
                          ]
                        );
                      } else if (typeExpr) {
                        const subClassExpr = ts.factory.createCallExpression(typeExpr, undefined, []);
                        assignmentExpr = ts.factory.createCallExpression(
                          ts.factory.createIdentifier("plainToInstance"),
                          undefined,
                          [subClassExpr, sourceAccess]
                        );
                      } else if (isDate) {
                        assignmentExpr = ts.factory.createConditionalExpression(
                          ts.factory.createBinaryExpression(
                            sourceAccess,
                            ts.SyntaxKind.ExclamationEqualsToken,
                            ts.factory.createNull()
                          ),
                          undefined,
                          ts.factory.createNewExpression(
                            ts.factory.createIdentifier("Date"),
                            undefined,
                            [sourceAccess]
                          ),
                          undefined,
                          sourceAccess
                        );
                      } else {
                        assignmentExpr = sourceAccess;
                      }

                      const checkAndAssign = ts.factory.createIfStatement(
                        ts.factory.createBinaryExpression(
                          sourceAccess,
                          ts.SyntaxKind.ExclamationEqualsEqualsToken,
                          ts.factory.createIdentifier("undefined")
                        ),
                        ts.factory.createExpressionStatement(
                          ts.factory.createBinaryExpression(
                            ts.factory.createPropertyAccessExpression(
                              ts.factory.createIdentifier("inst"),
                              ts.factory.createIdentifier(targetKey)
                            ),
                            ts.SyntaxKind.EqualsToken,
                            assignmentExpr
                          )
                        )
                      );

                      propertyAssignments.push(checkAndAssign);
                    }
                  });

                  // Return compiled arrow function:
                  // (data) => { ... }
                  const mapperArrowFn = ts.factory.createArrowFunction(
                    undefined,
                    undefined,
                    [
                      ts.factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        ts.factory.createIdentifier("data")
                      )
                    ],
                    undefined,
                    undefined,
                    ts.factory.createBlock([
                      ts.factory.createIfStatement(
                        ts.factory.createBinaryExpression(
                          ts.factory.createIdentifier("data"),
                          ts.SyntaxKind.EqualsEqualsToken,
                          ts.factory.createNull()
                        ),
                        ts.factory.createReturnStatement(ts.factory.createIdentifier("data"))
                      ),
                      ts.factory.createIfStatement(
                        ts.factory.createCallExpression(
                          ts.factory.createPropertyAccessExpression(
                            ts.factory.createIdentifier("Array"),
                            ts.factory.createIdentifier("isArray")
                          ),
                          undefined,
                          [ts.factory.createIdentifier("data")]
                        ),
                        ts.factory.createReturnStatement(
                          ts.factory.createCallExpression(
                            ts.factory.createPropertyAccessExpression(
                              ts.factory.createIdentifier("data"),
                              ts.factory.createIdentifier("map")
                            ),
                            undefined,
                            [
                              ts.factory.createArrowFunction(
                                undefined,
                                undefined,
                                [
                                  ts.factory.createParameterDeclaration(
                                    undefined,
                                    undefined,
                                    ts.factory.createIdentifier("item")
                                  )
                                ],
                                undefined,
                                undefined,
                                ts.factory.createCallExpression(
                                  ts.factory.createIdentifier("plainToInstance"),
                                  undefined,
                                  [classArg, ts.factory.createIdentifier("item")]
                                )
                              )
                            ]
                          )
                        )
                      ),
                      ts.factory.createVariableStatement(
                        undefined,
                        ts.factory.createVariableDeclarationList(
                          [
                            ts.factory.createVariableDeclaration(
                              ts.factory.createIdentifier("inst"),
                              undefined,
                              undefined,
                              ts.factory.createNewExpression(classArg, undefined, [])
                            )
                          ],
                          ts.NodeFlags.Const
                        )
                      ),
                      ...propertyAssignments,
                      ts.factory.createReturnStatement(ts.factory.createIdentifier("inst"))
                    ], true)
                  );

                  // Replace with arrow function call: ((data) => { ... })(payload)
                  return ts.factory.createCallExpression(
                    ts.factory.createParenthesizedExpression(mapperArrowFn),
                    undefined,
                    [payloadArg]
                  );
                }
              }
            }
          }
        }

        // 2. Intercept Parameter Decorator @FastMap() in Controller DTO parameters
        if (ts.isParameter(node)) {
          const decorators = ts.canHaveDecorators && ts.canHaveDecorators(node)
            ? ts.getDecorators(node)
            : (node as any).decorators;

          if (decorators) {
            const fastMapDecorator = decorators.find((d: any) => {
              const text = d.expression.getText();
              return text.startsWith('FastMap');
            });

            if (fastMapDecorator && node.type) {
              const dtoType = node.type;
              
              const bodyDecoratorCall = ts.factory.createCallExpression(
                ts.factory.createIdentifier("Body"),
                undefined,
                [
                  ts.factory.createCallExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("FastMapPipe"),
                      ts.factory.createIdentifier("get")
                    ),
                    undefined,
                    [dtoType as any]
                  )
                ]
              );

              const newDecorator = ts.factory.createDecorator(bodyDecoratorCall);

              const filteredModifiers = (node.modifiers || []).filter((m: any) => m !== fastMapDecorator);
              const newModifiers = ts.factory.createNodeArray([
                newDecorator,
                ...filteredModifiers
              ]);

              return ts.factory.updateParameterDeclaration(
                node,
                newModifiers,
                node.dotDotDotToken,
                node.name,
                node.questionToken,
                node.type,
                node.initializer
              );
            }
          }
        }

        return ts.visitEachChild(node, visit, context);
      }

      return ts.visitEachChild(sourceFile, visit, context);
    };
  };
}
