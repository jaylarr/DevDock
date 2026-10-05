import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.test-artifacts/**', 'project-demo/node_modules/**', 'project-demo/.runtime/**', 'project-demo/.cache/**', 'project-demo/output/**'] },
  ...tseslint.configs.recommended,
  { files: ['integrations/activity/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
