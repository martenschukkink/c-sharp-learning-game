window.LEVEL = { titel: 'Test genest', code: `
int x = 7;
for (int i = 0; i < 2; i++)
{
    if (x > 5)
    {
        x = x - 3;
    }
    else
    {
        if (x == 4)
        {
            Console.WriteLine("vier");
        }
        x++;
    }
}
int k = 0;
while (k < 2)
{
    k++;
    if (k == 1)
    {
        Console.Write("a");
    }
}
if (x > 100) { x = 0; }
else if (x > 3) { Console.WriteLine("groot"); }
else { Console.WriteLine("klein"); }
Console.WriteLine(x / 2);
double d = x / 2.0;
Console.WriteLine(d);
string s = "x=" + x;
s += "!";
Console.WriteLine(s);
bool b = !(x > 3) || false;
Console.WriteLine(b);
` };
