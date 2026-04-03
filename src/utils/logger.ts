import chalk from "chalk";

export const log = {
  info(msg: string): void {
    console.log(chalk.blue("i"), msg);
  },
  success(msg: string): void {
    console.log(chalk.green("✓"), msg);
  },
  warn(msg: string): void {
    console.log(chalk.yellow("⚠"), msg);
  },
  error(msg: string): void {
    console.error(chalk.red("✗"), msg);
  },
  tool(name: string, msg: string): void {
    console.log(chalk.dim(`  [${name}]`), chalk.dim(msg));
  },
  assistant(msg: string): void {
    console.log(msg);
  },
  dim(msg: string): void {
    console.log(chalk.dim(msg));
  },
};
