// Code Gangen – voorbeeldlevel: alles samen
window.LEVEL = {
  titel: 'Variabelen, if, &&, || en for',
  code: `
int sleutels = 0;
sleutels = sleutels + 1;

if (sleutels > 0)
{
    sleutels = sleutels - 1;
}

int energie = 3;
if (energie > 5)
{
    energie = energie - 5;
}
else
{
    energie = energie + 2;
}

bool heeftKaart = true;
if (heeftKaart && energie > 5)
{
    Console.WriteLine("Poort open");
}
else
{
    Console.WriteLine("Poort dicht");
}

if (sleutels > 0 || heeftKaart)
{
    energie = energie - 1;
}
else
{
    Console.WriteLine("Rust uit");
}

int munten = 0;
for (int i = 0; i < 3; i++)
{
    munten = munten + 10;
}

Console.WriteLine(munten);
`,
};
