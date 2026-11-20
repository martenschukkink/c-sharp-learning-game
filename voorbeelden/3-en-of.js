// Code Gangen – voorbeeldlevel: && en ||
window.LEVEL = {
  titel: 'Condities combineren met && en ||',
  code: `
int energie = 5;
bool heeftKaart = true;

if (heeftKaart && energie > 5)
{
    Console.WriteLine("Poort open");
}
else
{
    Console.WriteLine("Poort dicht");
}

if (energie > 5 || heeftKaart)
{
    energie = energie - 1;
}
else
{
    Console.WriteLine("Rust uit");
}
`,
};
